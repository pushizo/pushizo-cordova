package com.pushizo.cordova

import android.Manifest
import android.os.Build
import com.pushizo.sdk.Pushizo
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cordova → Pushizo Android SDK köprüsü (`cordova.exec` servisi "Pushizo"). Metotlar
 * [PushizoBridgeCore] üzerinden SDK'ya iletilir. SDK olayları JS'in `setEventCallback` ile açtığı tek
 * `keepCallback` kanalından `{ type, payload }` olarak gönderilir; kanal açılmadan gelen olaylar tamponlanır.
 */
class PushizoCordovaPlugin : CordovaPlugin() {
    private lateinit var core: PushizoBridgeCore
    private val lock = Any()
    private var eventCallback: CallbackContext? = null
    private val bufferedEvents = ArrayDeque<JSONObject>()
    private var pendingPermission: CallbackContext? = null
    private var pendingLocationPermission: CallbackContext? = null

    override fun pluginInitialize() {
        core = PushizoBridgeCore(cordova.activity.applicationContext) { type, payload -> sendEvent(type, payload) }
        core.attachIfInitialized()
    }

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "setEventCallback" -> openEventChannel(callbackContext)
            "requestPermission" -> requestPermission(callbackContext)
            "requestLocationPermission" -> requestLocationPermission(args.optJSONObject(0) ?: JSONObject(), callbackContext)
            else -> return core.handle(action, args.optJSONObject(0) ?: JSONObject(), reply(callbackContext))
        }
        return true
    }

    private fun reply(callbackContext: CallbackContext) = object : PushizoBridgeCore.Reply {
        override fun success(data: JSONObject?) {
            if (data == null) callbackContext.success() else callbackContext.success(data)
        }

        override fun error(code: String, message: String?) {
            callbackContext.error(JSONObject().put("code", code).put("message", message ?: code))
        }
    }

    // --- Olay kanalı ---

    private fun openEventChannel(callbackContext: CallbackContext) {
        val buffered: List<JSONObject>
        synchronized(lock) {
            eventCallback = callbackContext
            buffered = bufferedEvents.toList()
            bufferedEvents.clear()
        }
        callbackContext.sendPluginResult(PluginResult(PluginResult.Status.NO_RESULT).apply { keepCallback = true })
        buffered.forEach { deliver(callbackContext, it) }
    }

    private fun sendEvent(type: String, payload: JSONObject) {
        val message = JSONObject().put("type", type).put("payload", payload)
        val target = synchronized(lock) {
            eventCallback ?: run {
                // JS kanalı henüz açılmadı (soğuk başlatma): sınırlı tampon.
                bufferedEvents.addLast(message)
                while (bufferedEvents.size > MAX_BUFFERED_EVENTS) bufferedEvents.removeFirst()
                null
            }
        } ?: return
        deliver(target, message)
    }

    private fun deliver(callbackContext: CallbackContext, message: JSONObject) {
        callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK, message).apply { keepCallback = true })
    }

    // --- İzin ---

    /** Android 13+ POST_NOTIFICATIONS istemi; önceki sürümlerde çalışma zamanı izni yoktur, mevcut durum döner. */
    private fun requestPermission(callbackContext: CallbackContext) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || cordova.hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            core.onPermissionResult()
            callbackContext.success(core.permissionJson())
            return
        }
        synchronized(lock) { pendingPermission = callbackContext }
        cordova.requestPermission(this, PERMISSION_REQUEST_CODE, Manifest.permission.POST_NOTIFICATIONS)
    }

    /**
     * Konum izni (v2 Faz 17b): açıklama diyaloğu ve manifest denetimi [PushizoBridgeCore] içindedir; "Devam" seçilirse
     * sistem izni `Pushizo.Location.PERMISSION_REQUEST_CODE` ile istenir, sonuç [onRequestPermissionsResult] ile döner.
     */
    private fun requestLocationPermission(args: JSONObject, callbackContext: CallbackContext) {
        core.requestLocationPermission(cordova.activity, args, reply(callbackContext)) { permissions ->
            // Yanıtsız kalan önceki istek güncel izin durumuyla kapatılır.
            val previous = synchronized(lock) { pendingLocationPermission.also { pendingLocationPermission = callbackContext } }
            previous?.success(core.locationPermissionJson())
            cordova.requestPermissions(this, Pushizo.Location.PERMISSION_REQUEST_CODE, permissions)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        when (requestCode) {
            PERMISSION_REQUEST_CODE -> {
                core.onPermissionResult()
                val callback = synchronized(lock) { pendingPermission.also { pendingPermission = null } } ?: return
                // Sonuç sistem durumundan okunur (izin verilse de bildirimler uygulama ayarından kapalı olabilir).
                callback.success(core.permissionJson())
            }
            Pushizo.Location.PERMISSION_REQUEST_CODE -> {
                // SDK bilgilendirilir (izin verildiyse ve paylaşım açıksa konum gönderilir); sonuç sistem durumundan okunur.
                val result = core.onLocationPermissionResult()
                val callback = synchronized(lock) { pendingLocationPermission.also { pendingLocationPermission = null } } ?: return
                callback.success(result)
            }
        }
    }

    // --- Yaşam döngüsü ---

    override fun onReset() {
        // Sayfa yeniden yüklendi: eski JS kanalı geçersiz; yeni sayfa `setEventCallback` ile yeniden açar.
        synchronized(lock) { eventCallback = null }
        core.foregroundHandlerEnabled = false
    }

    override fun onDestroy() {
        core.detach()
        synchronized(lock) { eventCallback = null }
        super.onDestroy()
    }

    companion object {
        private const val PERMISSION_REQUEST_CODE = 0x4854
        private const val MAX_BUFFERED_EVENTS = 50
    }
}
