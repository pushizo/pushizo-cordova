package com.herosignal.cordova

import android.content.Context
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
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Köprüden bağımsız Android çekirdeği: JS metot adlarını HeroSignal Android SDK çağrılarına çevirir,
 * SDK olaylarını `emit(tür, veri)` ile köprüye iletir. Cordova eklentisi bu sınıfı sarar.
 */
internal class HeroSignalBridgeCore(
    private val context: Context,
    private val emit: (type: String, payload: JSONObject) -> Unit,
) {
    /** Metot sonucu; `success(null)` boş yanıt demektir. */
    interface Reply {
        fun success(data: JSONObject?)
        fun error(code: String, message: String?)
    }

    /** JS tarafında ön plan dinleyicisi varsa gösterim JS kararına bırakılır. */
    @Volatile var foregroundHandlerEnabled = false

    private val listenersRegistered = AtomicBoolean(false)
    @Volatile private var lastPermission: Boolean? = null
    private val foregroundSeq = AtomicLong(0)

    /** Karar bekleyen ön plan bildirimleri; en eski kayıtlar düşürülür (sınırlı bellek). */
    private val pendingForeground = object : LinkedHashMap<String, HsForegroundEvent>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, HsForegroundEvent>?): Boolean = size > MAX_PENDING_FOREGROUND
    }

    private val clickListener: (HsClickEvent) -> Unit = { e ->
        emit("click", JSONObject().put("notification", e.notification.toJson()).put("result", JSONObject().put("actionId", e.actionId.orNull()).put("url", e.url.orNull())))
    }

    private val foregroundListener: (HsForegroundEvent) -> Unit = { e ->
        val id = "fg-${foregroundSeq.incrementAndGet()}"
        val pending = foregroundHandlerEnabled
        if (pending) {
            // Yerel gösterim ertelenir; JS `display()` çağırırsa veya hiçbir dinleyici engellemezse gösterilir.
            e.preventDefault()
            synchronized(pendingForeground) { pendingForeground[id] = e }
        }
        emit("foregroundWillDisplay", JSONObject().put("notificationId", id).put("pending", pending).put("notification", e.notification.toJson()))
    }

    private val subscriptionObserver: (HsPushSubscriptionState) -> Unit = { s ->
        emit("pushSubscriptionChange", s.toJson())
        emitPermissionIfChanged(s.permission)
    }

    private val inAppClickListener: (HsInAppClickEvent) -> Unit = { e ->
        emit("inAppClick", JSONObject().put("message", JSONObject().put("id", e.messageId)).put("result", JSONObject().put("actionId", e.actionId).put("url", e.url.orNull())))
    }

    private val inAppLifecycleListener = object : HsInAppLifecycleListener {
        private fun send(event: String, e: HsInAppLifecycleEvent) =
            emit("inAppLifecycle", JSONObject().put("event", event).put("message", JSONObject().put("id", e.message.id)))
        override fun onWillDisplay(event: HsInAppLifecycleEvent) = send("willDisplay", event)
        override fun onDidDisplay(event: HsInAppLifecycleEvent) = send("didDisplay", event)
        override fun onWillDismiss(event: HsInAppLifecycleEvent) = send("willDismiss", event)
        override fun onDidDismiss(event: HsInAppLifecycleEvent) = send("didDismiss", event)
    }

    /** SDK zaten başlatıldıysa (kayıtlı ayarlarla süreç başında) dinleyicileri bağlar. */
    fun attachIfInitialized() {
        if (HeroSignal.isInitialized) registerListeners()
    }

    /** SDK dinleyicileri bir kez eklenir; soğuk başlatma tıklaması ilk tıklama dinleyicisine teslim edilir. */
    private fun registerListeners() {
        if (!listenersRegistered.compareAndSet(false, true)) return
        lastPermission = HeroSignal.Notifications.permission
        HeroSignal.Notifications.addClickListener(clickListener)
        HeroSignal.Notifications.addForegroundLifecycleListener(foregroundListener)
        HeroSignal.User.pushSubscription.addObserver(subscriptionObserver)
        HeroSignal.InAppMessages.addClickListener(inAppClickListener)
        HeroSignal.InAppMessages.addLifecycleListener(inAppLifecycleListener)
    }

    fun detach() {
        if (!listenersRegistered.compareAndSet(true, false)) return
        HeroSignal.Notifications.removeClickListener(clickListener)
        HeroSignal.Notifications.removeForegroundLifecycleListener(foregroundListener)
        HeroSignal.User.pushSubscription.removeObserver(subscriptionObserver)
        HeroSignal.InAppMessages.removeClickListener(inAppClickListener)
        HeroSignal.InAppMessages.removeLifecycleListener(inAppLifecycleListener)
        // Bekleyen ön plan bildirimleri kaybolmasın diye gösterilir.
        val pending = synchronized(pendingForeground) { pendingForeground.values.toList().also { pendingForeground.clear() } }
        pending.forEach { it.display() }
    }

    /** İzin sistem ayarlarından değişmiş olabilir (uygulama ön plana döndüğünde çağrılır). */
    fun checkPermission() {
        if (HeroSignal.isInitialized) emitPermissionIfChanged(HeroSignal.Notifications.permission)
    }

    /** İzin isteği sonuçlandı: SDK aboneliği günceller, değişim olayı gönderilir. */
    fun onPermissionResult() {
        HeroSignal.Notifications.onPermissionResult()
        checkPermission()
    }

    private fun emitPermissionIfChanged(permission: Boolean) {
        if (lastPermission == permission) return
        lastPermission = permission
        emit("permissionChange", JSONObject().put("permission", permission))
    }

    fun permissionJson(): JSONObject = JSONObject().put("permission", HeroSignal.Notifications.permission)

    /**
     * Metodu çalıştırır. Bilinmeyen metotta false döner. `requestPermission` Activity gerektirdiğinden
     * köprü sınıfında ele alınır.
     */
    fun handle(method: String, args: JSONObject, reply: Reply): Boolean {
        try {
            when (method) {
                "initialize" -> {
                    val config = HeroSignalConfigStore.Config(
                        appId = args.requireString("appId"),
                        apiUrl = args.optStringOrNull("apiUrl") ?: HeroSignal.Options().apiUrl,
                        requiresPrivacyConsent = args.optBoolean("requiresPrivacyConsent", false),
                        logLevel = args.optStringOrNull("logLevel") ?: "warn",
                    )
                    // Süreç yeniden başladığında (bildirim tıklaması, FCM servisi) SDK erkenden başlatılabilsin diye saklanır.
                    HeroSignalConfigStore.save(context, config)
                    HeroSignal.initialize(context, config.appId, config.toOptions())
                    registerListeners()
                    reply.success(null)
                }
                "setConsentGiven" -> { HeroSignal.setConsentGiven(args.optBoolean("given", false)); reply.success(null) }
                "login" -> { HeroSignal.login(args.requireString("externalId"), args.optStringOrNull("identityHash")); reply.success(null) }
                "logout" -> { HeroSignal.logout(); reply.success(null) }

                "addTags" -> { HeroSignal.User.addTags(args.stringMap("tags")); reply.success(null) }
                "removeTags" -> { HeroSignal.User.removeTags(args.stringList("keys")); reply.success(null) }
                "getTags" -> reply.success(JSONObject().put("tags", JSONObject(HeroSignal.User.getTags())))
                "addAliases" -> { HeroSignal.User.addAliases(args.stringMap("aliases")); reply.success(null) }
                "removeAlias" -> { HeroSignal.User.removeAlias(args.requireString("label")); reply.success(null) }
                "setLanguage" -> { HeroSignal.User.setLanguage(args.requireString("code")); reply.success(null) }
                // Geçersiz adres → IllegalArgumentException → INVALID_ARGUMENT
                "addEmail" -> { HeroSignal.User.addEmail(args.requireString("email")); reply.success(null) }
                "removeEmail" -> { HeroSignal.User.removeEmail(args.requireString("email")); reply.success(null) }
                "addSms" -> { HeroSignal.User.addSms(args.requireString("phoneNumber")); reply.success(null) }
                "removeSms" -> { HeroSignal.User.removeSms(args.requireString("phoneNumber")); reply.success(null) }
                "getUser" -> reply.success(JSONObject().put("id", HeroSignal.User.id.orNull()).put("externalId", HeroSignal.User.externalId.orNull()))

                "getPushSubscription" -> reply.success(HeroSignal.User.pushSubscription.state.toJson())
                "optIn" -> { HeroSignal.User.pushSubscription.optIn(); reply.success(null) }
                "optOut" -> { HeroSignal.User.pushSubscription.optOut(); reply.success(null) }

                "getPermission" -> reply.success(permissionJson())
                "clearAll" -> { HeroSignal.Notifications.clearAll(); reply.success(null) }
                "removeNotification" -> {
                    if (!args.has("id")) throw IllegalArgumentException("id gerekli")
                    HeroSignal.Notifications.removeNotification(args.getInt("id"))
                    reply.success(null)
                }
                "removeGroupedNotifications" -> { HeroSignal.Notifications.removeGroupedNotifications(args.requireString("group")); reply.success(null) }
                "setForegroundHandlerEnabled" -> { foregroundHandlerEnabled = args.optBoolean("enabled", false); reply.success(null) }
                "displayNotification" -> {
                    val id = args.requireString("notificationId")
                    val event = synchronized(pendingForeground) { pendingForeground.remove(id) }
                    if (event == null) {
                        reply.error("NOT_FOUND", "Bildirim bulunamadı veya zaten gösterildi.")
                    } else {
                        event.display()
                        reply.success(null)
                    }
                }

                "sendEvent" -> {
                    val value = if (args.has("value") && !args.isNull("value")) args.getDouble("value") else null
                    HeroSignal.Session.sendEvent(args.requireString("name"), args.optJSONObject("properties")?.toMap() ?: emptyMap(), value)
                    reply.success(null)
                }
                "setLogLevel" -> { HeroSignal.Debug.setLogLevel(logLevel(args.optStringOrNull("level"))); reply.success(null) }

                "addTriggers" -> { HeroSignal.InAppMessages.addTriggers(args.stringMap("triggers")); reply.success(null) }
                "removeTriggers" -> { HeroSignal.InAppMessages.removeTriggers(args.stringList("keys")); reply.success(null) }
                "clearTriggers" -> { HeroSignal.InAppMessages.clearTriggers(); reply.success(null) }
                "getTriggers" -> reply.success(JSONObject().put("triggers", JSONObject(HeroSignal.InAppMessages.getTriggers())))
                "setScreen" -> { HeroSignal.InAppMessages.setScreen(args.optStringOrNull("name")); reply.success(null) }
                "setInAppPaused" -> { HeroSignal.InAppMessages.paused = args.optBoolean("paused", false); reply.success(null) }
                "getInAppPaused" -> reply.success(JSONObject().put("paused", HeroSignal.InAppMessages.paused))

                "inboxList" -> HeroSignal.Inbox.list(args.optInt("limit", 50), args.optStringOrNull("cursor"), callback(reply) { it.toJson() })
                "inboxMarkRead" -> HeroSignal.Inbox.markRead(args.requireString("id"), callback(reply) { it.toJson() })
                "inboxMarkAllRead" -> HeroSignal.Inbox.markAllRead(callback(reply) { JSONObject().put("unreadCount", it) })
                "inboxArchive" -> HeroSignal.Inbox.archive(args.requireString("id"), callback(reply) { null })
                "inboxUnreadCount" -> HeroSignal.Inbox.unreadCount(callback(reply) { JSONObject().put("unreadCount", it) })
                else -> return false
            }
        } catch (e: IllegalArgumentException) {
            reply.error("INVALID_ARGUMENT", e.message)
        } catch (e: IllegalStateException) {
            reply.error("NOT_READY", e.message)
        } catch (e: Exception) {
            reply.error("HS_ERROR", e.message)
        }
        return true
    }

    /** SDK geri çağrısını köprü yanıtına çevirir; API hatasında sunucu kodu korunur. */
    private fun <T> callback(reply: Reply, map: (T) -> JSONObject?) = HsCallback<T> { result ->
        result.fold(
            onSuccess = { reply.success(map(it)) },
            onFailure = { e ->
                val code = when (e) {
                    is HsApiException -> e.code
                    is IllegalStateException -> "NOT_READY"
                    is IllegalArgumentException -> "INVALID_ARGUMENT"
                    else -> "HS_ERROR"
                }
                reply.error(code, e.message)
            },
        )
    }

    companion object {
        private const val MAX_PENDING_FOREGROUND = 32

        fun logLevel(name: String?): HsLog.Level = when (name) {
            "none" -> HsLog.Level.NONE
            "error" -> HsLog.Level.ERROR
            "info" -> HsLog.Level.INFO
            "debug" -> HsLog.Level.DEBUG
            else -> HsLog.Level.WARN
        }

        fun HsNotification.toJson(): JSONObject = JSONObject()
            .put("title", title.orNull())
            .put("body", body.orNull())
            .put("url", url.orNull())
            .put("imageUrl", imageUrl.orNull())
            .put("deliveryId", deliveryId.orNull())
            .put("messageId", messageId.orNull())
            .put("data", JSONObject(data))
            .put("androidNotificationId", androidNotificationId)

        fun HsPushSubscriptionState.toJson(): JSONObject = JSONObject()
            .put("id", id.orNull())
            .put("token", token.orNull())
            .put("optedIn", optedIn)
            .put("permission", permission)

        fun HsInboxItem.toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("messageId", messageId.orNull())
            .put("title", title.orNull())
            .put("body", body.orNull())
            .put("url", url.orNull())
            .put("imageUrl", imageUrl.orNull())
            .put("data", JSONObject(data))
            .put("read", read)
            .put("readAt", readAt.orNull())
            .put("archivedAt", archivedAt.orNull())
            .put("expiresAt", expiresAt.orNull())
            .put("createdAt", createdAt.orNull())

        fun HsInboxPage.toJson(): JSONObject = JSONObject()
            .put("items", JSONArray(items.map { it.toJson() }))
            .put("unreadCount", unreadCount)
            .put("nextCursor", nextCursor.orNull())
            .put("hasMore", hasMore)

        private fun Any?.orNull(): Any = this ?: JSONObject.NULL

        fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key) else null

        fun JSONObject.requireString(key: String): String =
            optStringOrNull(key)?.takeIf { it.isNotBlank() } ?: throw IllegalArgumentException("$key gerekli")

        fun JSONObject.stringMap(key: String): Map<String, String> {
            val obj = optJSONObject(key) ?: return emptyMap()
            val out = LinkedHashMap<String, String>()
            obj.keys().forEach { k -> if (!obj.isNull(k)) out[k] = obj.get(k).toString() }
            return out
        }

        fun JSONObject.stringList(key: String): List<String> {
            val arr = optJSONArray(key) ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i -> if (arr.isNull(i)) null else arr.get(i).toString() }
        }

        /** JSON nesnesini SDK'nın beklediği Map/List yapısına çevirir (iç içe değerler korunur). */
        fun JSONObject.toMap(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            keys().forEach { k -> out[k] = unwrap(get(k)) }
            return out
        }

        private fun unwrap(value: Any?): Any? = when (value) {
            JSONObject.NULL, null -> null
            is JSONObject -> value.toMap()
            is JSONArray -> (0 until value.length()).map { unwrap(value.get(it)) }
            else -> value
        }
    }
}
