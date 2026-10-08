package com.herosignal.cordova

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.herosignal.sdk.HeroSignal
import com.herosignal.sdk.HsApiException
import com.herosignal.sdk.HsCallback
import com.herosignal.sdk.HsClickEvent
import com.herosignal.sdk.HsForegroundEvent
import com.herosignal.sdk.HsInAppClickEvent
import com.herosignal.sdk.HsInAppLifecycleEvent
import com.herosignal.sdk.HsInAppLifecycleListener
import com.herosignal.sdk.HsInboxItem
import com.herosignal.sdk.HsInboxPage
import com.herosignal.sdk.HsLog
import com.herosignal.sdk.HsNotification
import com.herosignal.sdk.HsPushSubscriptionState
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Cordova → HeroSignal Android SDK köprüsü (`www/herosignal.js`). Her eylem tek bir seçenek nesnesi alır;
 * olaylar `registerEventListener` ile açılan kalıcı geri çağrıya (`keepCallback`) `{ type, data }` olarak gider.
 * In-app mesajları native SDK'nın varsayılan Dialog çizimiyle gösterilir.
 */
class HeroSignalCordova : CordovaPlugin() {
    private val main = Handler(Looper.getMainLooper())
    private var listenersAttached = false

    /** Kalıcı olay geri çağrısı; açılana kadar olaylar [pendingEvents] içinde bekler (soğuk açılış tıklaması). */
    private var eventCallback: CallbackContext? = null
    private val pendingEvents = ArrayDeque<JSONObject>()
    private val eventLock = Any()

    @Volatile private var foregroundHandlerEnabled = false
    private val pendingForeground = ConcurrentHashMap<String, HsForegroundEvent>()
    private val pendingPermission = ArrayDeque<CallbackContext>()

    private val clickListener: (HsClickEvent) -> Unit = { e -> emit("notificationClick", Mapper.click(e)) }

    private val foregroundListener: (HsForegroundEvent) -> Unit = { e ->
        if (foregroundHandlerEnabled) {
            // Gösterim JS kararına ertelenir; yanıt gelmezse zaman aşımında gösterilir.
            e.preventDefault()
            val eventId = UUID.randomUUID().toString()
            pendingForeground[eventId] = e
            main.postDelayed({ pendingForeground.remove(eventId)?.display() }, FOREGROUND_TIMEOUT_MS)
            emit("notificationWillDisplay", JSONObject().put("eventId", eventId).put("notification", Mapper.notification(e.notification)))
        }
    }

    private val subscriptionObserver: (HsPushSubscriptionState) -> Unit = { s ->
        emit("pushSubscriptionChange", JSONObject().put("current", Mapper.subscription(s)))
    }

    private val inAppClickListener: (HsInAppClickEvent) -> Unit = { e -> emit("inAppClick", Mapper.inAppClick(e)) }

    private val inAppLifecycleListener = object : HsInAppLifecycleListener {
        private fun send(type: String, e: HsInAppLifecycleEvent) = emit(type, Mapper.inAppMessage(e.message.id))
        override fun onWillDisplay(event: HsInAppLifecycleEvent) = send("inAppWillDisplay", event)
        override fun onDidDisplay(event: HsInAppLifecycleEvent) = send("inAppDidDisplay", event)
        override fun onWillDismiss(event: HsInAppLifecycleEvent) = send("inAppWillDismiss", event)
        override fun onDidDismiss(event: HsInAppLifecycleEvent) = send("inAppDidDismiss", event)
    }

    private fun emit(type: String, data: JSONObject) {
        val message = JSONObject().put("type", type).put("data", data)
        synchronized(eventLock) {
            val cb = eventCallback
            if (cb == null) {
                if (pendingEvents.size >= MAX_PENDING_EVENTS) pendingEvents.removeFirst()
                pendingEvents.addLast(message)
                return
            }
            send(cb, message)
        }
    }

    private fun send(cb: CallbackContext, message: JSONObject) {
        val result = PluginResult(PluginResult.Status.OK, message)
        result.keepCallback = true
        cb.sendPluginResult(result)
    }

    private fun attachListeners() {
        if (listenersAttached) return
        listenersAttached = true
        HeroSignal.Notifications.addClickListener(clickListener)
        HeroSignal.Notifications.addForegroundLifecycleListener(foregroundListener)
        HeroSignal.User.pushSubscription.addObserver(subscriptionObserver)
        HeroSignal.InAppMessages.addClickListener(inAppClickListener)
        HeroSignal.InAppMessages.addLifecycleListener(inAppLifecycleListener)
    }

    override fun onDestroy() {
        if (listenersAttached) {
            listenersAttached = false
            HeroSignal.Notifications.removeClickListener(clickListener)
            HeroSignal.Notifications.removeForegroundLifecycleListener(foregroundListener)
            HeroSignal.User.pushSubscription.removeObserver(subscriptionObserver)
            HeroSignal.InAppMessages.removeClickListener(inAppClickListener)
            HeroSignal.InAppMessages.removeLifecycleListener(inAppLifecycleListener)
        }
        pendingForeground.values.forEach { it.display() }
        pendingForeground.clear()
        main.removeCallbacksAndMessages(null)
        synchronized(eventLock) { eventCallback = null }
    }

    override fun execute(action: String, args: JSONArray, callbackContext: CallbackContext): Boolean {
        val o = args.optJSONObject(0) ?: JSONObject()
        try {
            when (action) {
                "registerEventListener" -> {
                    synchronized(eventLock) {
                        eventCallback = callbackContext
                        while (pendingEvents.isNotEmpty()) send(callbackContext, pendingEvents.removeFirst())
                    }
                    val result = PluginResult(PluginResult.Status.NO_RESULT)
                    result.keepCallback = true
                    callbackContext.sendPluginResult(result)
                }
                "initialize" -> {
                    HeroSignal.initialize(
                        cordova.context.applicationContext,
                        o.requireString("appId"),
                        HeroSignal.Options(
                            apiUrl = o.optStringOrNull("apiUrl") ?: HeroSignal.Options().apiUrl,
                            requiresPrivacyConsent = o.optBoolean("requiresPrivacyConsent", false),
                            logLevel = Mapper.logLevel(o.optStringOrNull("logLevel")),
                        ),
                    )
                    attachListeners()
                    callbackContext.success()
                }
                "setConsentGiven" -> { HeroSignal.setConsentGiven(o.optBoolean("given", false)); callbackContext.success() }
                "login" -> { HeroSignal.login(o.requireString("externalId"), o.optStringOrNull("identityHash")); callbackContext.success() }
                "logout" -> { HeroSignal.logout(); callbackContext.success() }

                "addTags" -> { HeroSignal.User.addTags(Mapper.stringMap(o.optJSONObject("tags"))); callbackContext.success() }
                "removeTags" -> { HeroSignal.User.removeTags(Mapper.stringList(o.optJSONArray("keys"))); callbackContext.success() }
                "getTags" -> callbackContext.success(JSONObject().put("tags", JSONObject(HeroSignal.User.getTags())))
                "addAliases" -> { HeroSignal.User.addAliases(Mapper.stringMap(o.optJSONObject("aliases"))); callbackContext.success() }
                "removeAlias" -> { HeroSignal.User.removeAlias(o.requireString("label")); callbackContext.success() }
                "setLanguage" -> { HeroSignal.User.setLanguage(o.requireString("code")); callbackContext.success() }
                "addEmail" -> { HeroSignal.User.addEmail(o.optString("email")); callbackContext.success() }
                "removeEmail" -> { HeroSignal.User.removeEmail(o.optString("email")); callbackContext.success() }
                "addSms" -> { HeroSignal.User.addSms(o.optString("phoneNumber")); callbackContext.success() }
                "removeSms" -> { HeroSignal.User.removeSms(o.optString("phoneNumber")); callbackContext.success() }
                "getUser" -> callbackContext.success(
                    JSONObject().put("id", HeroSignal.User.id ?: JSONObject.NULL).put("externalId", HeroSignal.User.externalId ?: JSONObject.NULL),
                )
                "getPushSubscription" -> callbackContext.success(Mapper.subscription(HeroSignal.User.pushSubscription.state))
                "optIn" -> { HeroSignal.User.pushSubscription.optIn(); callbackContext.success() }
                "optOut" -> { HeroSignal.User.pushSubscription.optOut(); callbackContext.success() }

                "getPermission" -> callbackContext.success(permissionResult())
                "requestPermission" -> requestPermission(callbackContext)
                "setForegroundHandlerEnabled" -> {
                    foregroundHandlerEnabled = o.optBoolean("enabled", false)
                    if (!foregroundHandlerEnabled) {
                        // Bekleyen kararlar varsayılan davranışa (göster) döner.
                        pendingForeground.keys.toList().forEach { id -> pendingForeground.remove(id)?.display() }
                    }
                    callbackContext.success()
                }
                "completeForegroundDisplay" -> {
                    val event = pendingForeground.remove(o.requireString("eventId"))
                    if (event != null && o.optBoolean("display", true)) event.display()
                    callbackContext.success()
                }
                "clearAll" -> { HeroSignal.Notifications.clearAll(); callbackContext.success() }
                "removeNotification" -> { HeroSignal.Notifications.removeNotification(Mapper.androidNotificationId(o.optStringOrNull("id"))); callbackContext.success() }
                "removeGroupedNotifications" -> { HeroSignal.Notifications.removeGroupedNotifications(o.requireString("group")); callbackContext.success() }

                "sendEvent" -> {
                    val value = (o.opt("value") as? Number)?.toDouble()
                    HeroSignal.Session.sendEvent(o.requireString("name"), Mapper.anyMap(o.optJSONObject("properties")), value)
                    callbackContext.success()
                }

                "addTriggers" -> { HeroSignal.InAppMessages.addTriggers(Mapper.stringMap(o.optJSONObject("triggers"))); callbackContext.success() }
                "removeTriggers" -> { HeroSignal.InAppMessages.removeTriggers(Mapper.stringList(o.optJSONArray("keys"))); callbackContext.success() }
                "clearTriggers" -> { HeroSignal.InAppMessages.clearTriggers(); callbackContext.success() }
                "getTriggers" -> callbackContext.success(JSONObject().put("triggers", JSONObject(HeroSignal.InAppMessages.getTriggers())))
                "setScreen" -> { HeroSignal.InAppMessages.setScreen(o.optStringOrNull("name")); callbackContext.success() }
                "setInAppPaused" -> { HeroSignal.InAppMessages.paused = o.optBoolean("paused", false); callbackContext.success() }
                "getInAppPaused" -> callbackContext.success(JSONObject().put("paused", HeroSignal.InAppMessages.paused))

                "inboxList" -> HeroSignal.Inbox.list(o.optInt("limit", 50), o.optStringOrNull("cursor"), reply(callbackContext) { Mapper.inboxPage(it) })
                "inboxMarkRead" -> HeroSignal.Inbox.markRead(o.requireString("id"), reply(callbackContext) { JSONObject().put("item", Mapper.inboxItem(it)) })
                "inboxMarkAllRead" -> HeroSignal.Inbox.markAllRead(reply(callbackContext) { JSONObject().put("unreadCount", it) })
                "inboxDelete" -> HeroSignal.Inbox.archive(o.requireString("id"), reply<Unit>(callbackContext) { null })
                "inboxUnreadCount" -> HeroSignal.Inbox.unreadCount(reply(callbackContext) { JSONObject().put("unreadCount", it) })

                "setLogLevel" -> { HeroSignal.Debug.setLogLevel(Mapper.logLevel(o.optStringOrNull("level"))); callbackContext.success() }
                else -> return false
            }
        } catch (e: Exception) {
            callbackContext.error(Mapper.error(e))
        }
        return true
    }

    // --- İzin ---

    private fun permissionResult(): JSONObject {
        val granted = HeroSignal.Notifications.permission
        val status = when {
            granted -> "granted"
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                // Android ilk istemi kalıcı retten ayırt etmez; gerekçe gösterilebiliyorsa en az bir kez reddedilmiştir.
                if (cordova.activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) "denied" else "default"
            else -> "denied"
        }
        return JSONObject().put("granted", granted).put("status", status)
    }

    private fun requestPermission(callbackContext: CallbackContext) {
        if (HeroSignal.Notifications.permission || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            HeroSignal.Notifications.onPermissionResult()
            callbackContext.success(permissionResult())
            return
        }
        synchronized(pendingPermission) { pendingPermission.addLast(callbackContext) }
        cordova.requestPermission(this, PERMISSION_REQUEST_CODE, Manifest.permission.POST_NOTIFICATIONS)
    }

    @Deprecated("CordovaInterfaceImpl hâlâ bu metodu çağırır (cordova-android 12/13).")
    override fun onRequestPermissionResult(requestCode: Int, permissions: Array<out String>?, grantResults: IntArray?) {
        if (requestCode != PERMISSION_REQUEST_CODE) return
        HeroSignal.Notifications.onPermissionResult()
        val granted = grantResults?.firstOrNull() == PackageManager.PERMISSION_GRANTED
        val result = permissionResult().put("granted", granted || HeroSignal.Notifications.permission)
        val waiting = synchronized(pendingPermission) { pendingPermission.toList().also { pendingPermission.clear() } }
        waiting.forEach { it.success(result) }
    }

    /** SDK'nın arka plan geri çağrısını Cordova sonucuna çevirir. */
    private fun <T> reply(callbackContext: CallbackContext, map: (T) -> JSONObject?) = HsCallback<T> { r ->
        r.fold(
            onSuccess = { value -> map(value)?.let(callbackContext::success) ?: callbackContext.success() },
            onFailure = { e -> callbackContext.error(Mapper.error(e)) },
        )
    }

    private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }

    private fun JSONObject.requireString(key: String): String =
        optStringOrNull(key)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("$key gerekli.")

    companion object {
        private const val PERMISSION_REQUEST_CODE = 0x4854
        private const val FOREGROUND_TIMEOUT_MS = 25_000L
        private const val MAX_PENDING_EVENTS = 50
    }

    /** JS ↔ SDK model ve argüman dönüşümleri (`types/index.d.ts` ile aynı alan adları). */
    internal object Mapper {
        fun logLevel(name: String?): HsLog.Level = when (name) {
            "none" -> HsLog.Level.NONE
            "error" -> HsLog.Level.ERROR
            "info" -> HsLog.Level.INFO
            "debug" -> HsLog.Level.DEBUG
            else -> HsLog.Level.WARN
        }

        fun error(e: Throwable): JSONObject {
            val code = when (e) {
                is HsApiException -> e.code
                is IllegalArgumentException -> "INVALID_ARGUMENT"
                is IllegalStateException -> "NOT_READY"
                else -> "HS_ERROR"
            }
            return JSONObject().put("code", code).put("message", e.message ?: code)
        }

        fun androidNotificationId(raw: String?): Int =
            raw?.trim()?.toIntOrNull() ?: throw IllegalArgumentException("Android bildirim kimliği tam sayı olmalı.")

        fun stringMap(obj: JSONObject?): Map<String, String> {
            if (obj == null) return emptyMap()
            val out = LinkedHashMap<String, String>()
            for (key in obj.keys()) {
                val value = obj.opt(key)
                if (value == null || value == JSONObject.NULL) continue
                out[key] = value.toString()
            }
            return out
        }

        fun stringList(arr: JSONArray?): List<String> {
            if (arr == null) return emptyList()
            return (0 until arr.length()).mapNotNull { i -> arr.opt(i)?.takeIf { it != JSONObject.NULL }?.toString() }
        }

        fun anyMap(obj: JSONObject?): Map<String, Any?> {
            if (obj == null) return emptyMap()
            val out = LinkedHashMap<String, Any?>()
            for (key in obj.keys()) out[key] = obj.opt(key).takeIf { it != JSONObject.NULL }
            return out
        }

        private fun JSONObject.putNullable(key: String, value: Any?): JSONObject = put(key, value ?: JSONObject.NULL)

        fun notification(n: HsNotification): JSONObject {
            val actions = JSONArray()
            n.actions.forEach { a -> actions.put(JSONObject().put("id", a.id).put("title", a.title).putNullable("url", a.url)) }
            return JSONObject()
                .putNullable("notificationId", n.androidNotificationId?.toString())
                .putNullable("title", n.title)
                .putNullable("body", n.body)
                .putNullable("url", n.url)
                .putNullable("imageUrl", n.imageUrl)
                .putNullable("deliveryId", n.deliveryId)
                .putNullable("messageId", n.messageId)
                .putNullable("groupKey", n.groupKey)
                .put("actions", actions)
                .put("data", JSONObject(n.data))
        }

        fun click(e: HsClickEvent): JSONObject = JSONObject()
            .put("notification", notification(e.notification))
            .put("result", JSONObject().putNullable("actionId", e.actionId).putNullable("url", e.url))

        fun subscription(s: HsPushSubscriptionState): JSONObject =
            JSONObject().putNullable("id", s.id).putNullable("token", s.token).put("optedIn", s.optedIn)

        fun inAppMessage(id: String): JSONObject = JSONObject().put("message", JSONObject().put("id", id))

        fun inAppClick(e: HsInAppClickEvent): JSONObject = inAppMessage(e.messageId)
            .put("result", JSONObject().put("actionId", e.actionId).putNullable("url", e.url))

        /** Epoch milisaniye → ISO-8601 UTC (web SDK ile aynı biçim). */
        fun isoTime(ms: Long?): String? {
            if (ms == null) return null
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            return format.format(Date(ms))
        }

        fun inboxItem(item: HsInboxItem): JSONObject = JSONObject()
            .put("id", item.id)
            .putNullable("messageId", item.messageId)
            .putNullable("title", item.title)
            .putNullable("body", item.body)
            .putNullable("url", item.url)
            .putNullable("imageUrl", item.imageUrl)
            .put("data", JSONObject(item.data))
            .put("read", item.read)
            .putNullable("readAt", isoTime(item.readAt))
            .putNullable("archivedAt", isoTime(item.archivedAt))
            .putNullable("expiresAt", isoTime(item.expiresAt))
            .putNullable("createdAt", isoTime(item.createdAt))

        fun inboxPage(page: HsInboxPage): JSONObject {
            val items = JSONArray()
            page.items.forEach { items.put(inboxItem(it)) }
            return JSONObject()
                .put("items", items)
                .put("unreadCount", page.unreadCount)
                .putNullable("nextCursor", page.nextCursor)
                .put("hasMore", page.hasMore)
        }
    }
}
