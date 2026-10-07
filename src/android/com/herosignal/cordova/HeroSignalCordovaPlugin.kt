package com.herosignal.cordova

import android.Manifest
import android.os.Build
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cordova → HeroSignal Android SDK köprüsü (`cordova.exec` servisi "HeroSignal"). Metotlar
 * [HeroSignalBridgeCore] üzerinden SDK'ya iletilir. SDK olayları JS'in `setEventCallback` ile açtığı tek
 * `keepCallback` kanalından `{ type, payload }` olarak gönderilir; kanal açılmadan gelen olaylar tamponlanır.
 */
class HeroSignalCordovaPlugin : CordovaPlugin() {
    private lateinit var core: HeroSignalBridgeCore
    private val lock = Any()
    private var eventCallback: CallbackContext? = null
    private val bufferedEvents = ArrayDeque<JSONObject>()
    private var pendingPermission: CallbackContext? = null

    override fun pluginInitialize() {
        core = HeroSignalBridgeCore(cordova.activity.applicationContext) { type, payload -> sendEvent(type, payload) }
        core.attachIfInitialized()
    }

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        when (action) {
            "setEventCallback" -> openEventChannel(callbackContext)
            "requestPermission" -> requestPermission(callbackContext)
            else -> return core.handle(action, args.optJSONObject(0) ?: JSONObject(), reply(callbackContext))
        }
        return true
    }

    private fun reply(callbackContext: CallbackContext) = object : HeroSignalBridgeCore.Reply {
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        if (requestCode != PERMISSION_REQUEST_CODE) return
        core.onPermissionResult()
        val callback = synchronized(lock) { pendingPermission.also { pendingPermission = null } } ?: return
        // Sonuç sistem durumundan okunur (izin verilse de bildirimler uygulama ayarından kapalı olabilir).
        callback.success(core.permissionJson())
    }

    // --- Yaşam döngüsü ---

    override fun onResume(multitasking: Boolean) {
        super.onResume(multitasking)
        core.checkPermission()
    }

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
