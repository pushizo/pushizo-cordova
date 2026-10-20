package com.pushizo.cordova

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.pushizo.sdk.Pushizo
import com.pushizo.sdk.HsApiException
import com.pushizo.sdk.HsCallback
import com.pushizo.sdk.HsChatEventAdapter
import com.pushizo.sdk.HsChatOpenListener
import com.pushizo.sdk.HsClickEvent
import com.pushizo.sdk.HsForegroundEvent
import com.pushizo.sdk.HsInAppClickEvent
import com.pushizo.sdk.HsInAppLifecycleEvent
import com.pushizo.sdk.HsInAppLifecycleListener
import com.pushizo.sdk.HsInboxItem
import com.pushizo.sdk.HsInboxPage
import com.pushizo.sdk.HsLog
import com.pushizo.sdk.HsMessageCategory
import com.pushizo.sdk.HsNotification
import com.pushizo.sdk.HsPreference
import com.pushizo.sdk.HsPreferenceInput
import com.pushizo.sdk.HsPreferencesResult
import com.pushizo.sdk.HsPushSubscriptionState
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Köprüden bağımsız Android çekirdeği: JS metot adlarını Pushizo Android SDK çağrılarına çevirir,
 * SDK olaylarını `emit(tür, veri)` ile köprüye iletir. Cordova eklentisi bu sınıfı sarar.
 */
internal class PushizoBridgeCore(
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

    private val subscriptionObserver: (HsPushSubscriptionState) -> Unit = { s -> emit("pushSubscriptionChange", s.toJson()) }

    /**
     * Yerel SDK izin gözlemcisi: izin isteği sonucu ve uygulama ön plana döndüğünde (izin sistem ayarlarından
     * değişmiş olabilir) etkin izin değiştiyse çağrılır.
     */
    private val permissionObserver: (Boolean) -> Unit = { granted -> emit("permissionChange", JSONObject().put("permission", granted)) }

    private val inAppClickListener: (HsInAppClickEvent) -> Unit = { e ->
        emit("inAppClick", JSONObject().put("message", JSONObject().put("id", e.messageId)).put("result", JSONObject().put("actionId", e.actionId).put("url", e.url.orNull())))
    }

    /** Canlı sohbet olayları → JS `chatEvent` (`{ type: message|typing|read|unread|conversation|connection|error, ... }`). */
    private val chatListener = HsChatEventAdapter { type, payload -> emit("chatEvent", JSONObject(payload).put("type", type)) }

    /** Sohbet bildirimine tıklama → JS `chatOpen` (cephe dinleyici yoksa bekletir). */
    private val chatOpenListener = HsChatOpenListener { info -> emit("chatOpen", JSONObject(info.toMap())) }

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
        if (Pushizo.isInitialized) registerListeners()
    }

    /** SDK dinleyicileri bir kez eklenir; soğuk başlatma tıklaması ilk tıklama dinleyicisine teslim edilir. */
    private fun registerListeners() {
        if (!listenersRegistered.compareAndSet(false, true)) return
        Pushizo.Notifications.addClickListener(clickListener)
        Pushizo.Notifications.addForegroundLifecycleListener(foregroundListener)
        Pushizo.User.pushSubscription.addObserver(subscriptionObserver)
        Pushizo.Notifications.addPermissionObserver(permissionObserver)
        Pushizo.InAppMessages.addClickListener(inAppClickListener)
        Pushizo.InAppMessages.addLifecycleListener(inAppLifecycleListener)
        Pushizo.Chat.addListener(chatListener)
        Pushizo.Chat.addOpenListener(chatOpenListener)
    }

    fun detach() {
        if (!listenersRegistered.compareAndSet(true, false)) return
        Pushizo.Notifications.removeClickListener(clickListener)
        Pushizo.Notifications.removeForegroundLifecycleListener(foregroundListener)
        Pushizo.User.pushSubscription.removeObserver(subscriptionObserver)
        Pushizo.Notifications.removePermissionObserver(permissionObserver)
        Pushizo.InAppMessages.removeClickListener(inAppClickListener)
        Pushizo.InAppMessages.removeLifecycleListener(inAppLifecycleListener)
        Pushizo.Chat.removeListener(chatListener)
        Pushizo.Chat.removeOpenListener(chatOpenListener)
        // Bekleyen ön plan bildirimleri kaybolmasın diye gösterilir.
        val pending = synchronized(pendingForeground) { pendingForeground.values.toList().also { pendingForeground.clear() } }
        pending.forEach { it.display() }
    }

    /** İzin isteği sonuçlandı: SDK aboneliği günceller; izin değiştiyse yerel izin gözlemcisi olayı gönderir. */
    fun onPermissionResult() {
        Pushizo.Notifications.onPermissionResult()
    }

    fun permissionJson(): JSONObject = JSONObject().put("permission", Pushizo.Notifications.permission)

    // --- Konum izni (v2 Faz 17b) ---

    /**
     * Konum izni akışı: Android SDK'nın `Location.requestPermission` sonucu geri çağrıyla bildirilmediğinden köprü aynı
     * adımları kendi izin mekanizmasıyla yürütür. İzin zaten varsa true; uygulama manifest'inde konum izni yoksa veya
     * Activity yoksa false. Değilse açıklama diyaloğu gösterilir (başlık/düğmeler SDK string kaynakları, mesaj
     * `rationale` ya da SDK varsayılanı); "Şimdi değil"/iptal false döner, "Devam" ise [requestSystem] ile köprünün izin
     * API'si üzerinden sistem izni istenir — sonuç geldiğinde köprü [onLocationPermissionResult] yanıtını döndürür.
     */
    fun requestLocationPermission(activity: Activity?, args: JSONObject, reply: Reply, requestSystem: (Array<String>) -> Unit) {
        if (!Pushizo.isInitialized) {
            reply.error("NOT_READY", NOT_INITIALIZED)
            return
        }
        if (Pushizo.Location.permissionGranted) {
            reply.success(onLocationPermissionResult())
            return
        }
        val permissions = declaredLocationPermissions()
        if (permissions.isEmpty()) {
            HsLog.w("konum izni istenemedi: uygulama manifest'inde ACCESS_COARSE_LOCATION/ACCESS_FINE_LOCATION yok")
            reply.success(locationPermissionJson())
            return
        }
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            HsLog.w("konum izni istenemedi: etkin Activity yok")
            reply.success(locationPermissionJson())
            return
        }
        val rationale = args.optStringOrNull("rationale")?.takeIf { it.isNotBlank() }
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) {
                reply.success(locationPermissionJson())
                return@runOnUiThread
            }
            AlertDialog.Builder(activity)
                .setTitle(com.pushizo.sdk.R.string.hs_location_rationale_title)
                .setMessage(rationale ?: activity.getString(com.pushizo.sdk.R.string.hs_location_rationale_message))
                .setPositiveButton(com.pushizo.sdk.R.string.hs_location_rationale_continue) { _, _ -> requestSystem(permissions) }
                .setNegativeButton(com.pushizo.sdk.R.string.hs_location_rationale_not_now) { _, _ -> reply.success(locationPermissionJson()) }
                .setOnCancelListener { reply.success(locationPermissionJson()) }
                .show()
        }
    }

    /** Sistem izin sonucu: SDK bilgilendirilir (izin verildiyse ve paylaşım açıksa konum gönderilir), güncel izin döner. */
    fun onLocationPermissionResult(): JSONObject {
        Pushizo.Location.onPermissionResult()
        return locationPermissionJson()
    }

    fun locationPermissionJson(): JSONObject = JSONObject().put("permission", Pushizo.Location.permissionGranted)

    /** Uygulama manifest'inde tanımlı konum izinleri (eklenti izinleri otomatik eklemez; README "Konum"). */
    private fun declaredLocationPermissions(): Array<String> {
        val requested = try {
            val pm = context.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            }
            info.requestedPermissions?.toSet().orEmpty()
        } catch (e: PackageManager.NameNotFoundException) {
            emptySet()
        }
        return LOCATION_PERMISSIONS.filter { it in requested }.toTypedArray()
    }

    /**
     * Metodu çalıştırır. Bilinmeyen metotta false döner. `requestPermission` ve `requestLocationPermission` Activity
     * gerektirdiğinden köprü sınıfında ele alınır.
     */
    fun handle(method: String, args: JSONObject, reply: Reply): Boolean {
        try {
            when (method) {
                "initialize" -> {
                    val config = PushizoConfigStore.Config(
                        appId = args.requireString("appId"),
                        apiUrl = args.optStringOrNull("apiUrl") ?: Pushizo.Options().apiUrl,
                        requiresPrivacyConsent = args.optBoolean("requiresPrivacyConsent", false),
                        logLevel = args.optStringOrNull("logLevel") ?: "warn",
                    )
                    // Süreç yeniden başladığında (bildirim tıklaması, FCM servisi) SDK erkenden başlatılabilsin diye saklanır.
                    PushizoConfigStore.save(context, config)
                    Pushizo.initialize(context, config.appId, config.toOptions())
                    registerListeners()
                    reply.success(null)
                }
                "setConsentGiven" -> { Pushizo.setConsentGiven(args.optBoolean("given", false)); reply.success(null) }
                "login" -> {
                    Pushizo.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))
                    reply.success(null)
                }
                "updateUserJwt" -> { Pushizo.updateUserJwt(args.requireString("jwt")); reply.success(null) }
                "logout" -> { Pushizo.logout(); reply.success(null) }

                "addTags" -> { Pushizo.User.addTags(args.stringMap("tags")); reply.success(null) }
                "removeTags" -> { Pushizo.User.removeTags(args.stringList("keys")); reply.success(null) }
                "getTags" -> reply.success(JSONObject().put("tags", JSONObject(Pushizo.User.getTags())))
                "addAliases" -> { Pushizo.User.addAliases(args.stringMap("aliases")); reply.success(null) }
                "removeAlias" -> { Pushizo.User.removeAlias(args.requireString("label")); reply.success(null) }
                "setLanguage" -> { Pushizo.User.setLanguage(args.requireString("code")); reply.success(null) }
                // Geçersiz adres → IllegalArgumentException → INVALID_ARGUMENT
                "addEmail" -> { Pushizo.User.addEmail(args.requireString("email")); reply.success(null) }
                "removeEmail" -> { Pushizo.User.removeEmail(args.requireString("email")); reply.success(null) }
                "addSms" -> { Pushizo.User.addSms(args.requireString("phoneNumber")); reply.success(null) }
                "removeSms" -> { Pushizo.User.removeSms(args.requireString("phoneNumber")); reply.success(null) }
                "getUser" -> reply.success(JSONObject().put("id", Pushizo.User.id.orNull()).put("externalId", Pushizo.User.externalId.orNull()))
                "getContacts" -> reply.success(
                    JSONObject().put("emails", JSONArray(Pushizo.User.emails)).put("smsNumbers", JSONArray(Pushizo.User.smsNumbers)),
                )
                // Tercihler (ADR-0019 §4): sahiplik kanıtı yerel SDK'da eklenir; doğrulama hatası INVALID_ARGUMENT, abonelik yoksa NOT_READY.
                "getPreferences" -> Pushizo.User.getPreferences(callback(reply) { it.toJson() })
                "setPreferences" -> Pushizo.User.setPreferences(args.preferenceInputs("preferences"), callback(reply) { it.toJson() })

                "getPushSubscription" -> reply.success(Pushizo.User.pushSubscription.state.toJson())
                "optIn" -> { Pushizo.User.pushSubscription.optIn(); reply.success(null) }
                "optOut" -> { Pushizo.User.pushSubscription.optOut(); reply.success(null) }

                "getPermission" -> reply.success(permissionJson())
                "clearAll" -> { Pushizo.Notifications.clearAll(); reply.success(null) }
                "removeNotification" -> {
                    // Android tepsi kimliği tamsayıdır; metin kimlik (iOS biçimi) yalnızca sayıysa kabul edilir.
                    val id = when {
                        args.has("id") -> args.getInt("id")
                        else -> args.optStringOrNull("identifier")?.trim()?.toIntOrNull()
                            ?: throw IllegalArgumentException("id gerekli (Android bildirim kimliği tamsayıdır)")
                    }
                    Pushizo.Notifications.removeNotification(id)
                    reply.success(null)
                }
                "removeGroupedNotifications" -> { Pushizo.Notifications.removeGroupedNotifications(args.requireString("group")); reply.success(null) }
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
                    Pushizo.Session.sendEvent(args.requireString("name"), args.optJSONObject("properties")?.toMap() ?: emptyMap(), value)
                    reply.success(null)
                }
                "setLogLevel" -> { Pushizo.Debug.setLogLevel(logLevel(args.optStringOrNull("level"))); reply.success(null) }

                "addTriggers" -> { Pushizo.InAppMessages.addTriggers(args.stringMap("triggers")); reply.success(null) }
                "removeTriggers" -> { Pushizo.InAppMessages.removeTriggers(args.stringList("keys")); reply.success(null) }
                "clearTriggers" -> { Pushizo.InAppMessages.clearTriggers(); reply.success(null) }
                "getTriggers" -> reply.success(JSONObject().put("triggers", JSONObject(Pushizo.InAppMessages.getTriggers())))
                "setScreen" -> { Pushizo.InAppMessages.setScreen(args.optStringOrNull("name")); reply.success(null) }
                "setInAppPaused" -> { Pushizo.InAppMessages.paused = args.optBoolean("paused", false); reply.success(null) }
                "getInAppPaused" -> reply.success(JSONObject().put("paused", Pushizo.InAppMessages.paused))

                "inboxList" -> Pushizo.Inbox.list(args.optInt("limit", 50), args.optStringOrNull("cursor"), callback(reply) { it.toJson() })
                "inboxMarkRead" -> Pushizo.Inbox.markRead(args.requireString("id"), callback(reply) { it.toJson() })
                "inboxMarkAllRead" -> Pushizo.Inbox.markAllRead(callback(reply) { JSONObject().put("unreadCount", it) })
                "inboxArchive" -> Pushizo.Inbox.archive(args.requireString("id"), callback(reply) { null })
                "inboxUnreadCount" -> Pushizo.Inbox.unreadCount(callback(reply) { JSONObject().put("unreadCount", it) })

                // Konum (v2 Faz 17b): izin isteği Activity gerektirdiğinden köprü sınıfında ele alınır.
                "setLocationShared" -> {
                    check(Pushizo.isInitialized) { NOT_INITIALIZED }
                    Pushizo.Location.setShared(args.optBoolean("shared", false))
                    reply.success(null)
                }
                "isLocationShared" -> reply.success(JSONObject().put("shared", Pushizo.Location.isShared))

                // Live Activities yalnızca iOS'ta vardır (ADR-0024); Android'de sessizce başarılı dönülmez.
                "setupDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE, LIVE_ACTIVITY_UNSUPPORTED_MESSAGE)
                "startDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE, LIVE_ACTIVITY_UNSUPPORTED_MESSAGE)
                // Canlı sohbet (ADR-0040): kimlik, kuyruk, akış ve push native SDK'dadır.
                "chatStart" -> Pushizo.Chat.start(args.optStringOrNull("name"), args.optStringOrNull("email"), args.optStringOrNull("language"), callback(reply) { JSONObject(it.toMap()) })
                "chatGetConfig" -> Pushizo.Chat.getConfig(args.optStringOrNull("language"), callback(reply) { JSONObject(it.toMap()) })
                "chatGetConversation" -> Pushizo.Chat.getConversation(callback(reply) { JSONObject(it.toMap()) })
                "chatGetMessages" -> Pushizo.Chat.getMessages(
                    args.optLongOrNull("afterSeq"), args.optLongOrNull("beforeSeq"), args.optInt("limit", 50), callback(reply) { JSONObject(it.toMap()) },
                )
                "chatSendMessage" -> Pushizo.Chat.sendMessage(args.requireString("text"), args.optStringOrNull("optionId"), callback(reply) { it.toJson() })
                "chatSendAttachment" -> {
                    val fileName = args.requireString("fileName")
                    val mimeType = args.requireString("mimeType")
                    val text = args.optStringOrNull("text")
                    val base64 = args.optStringOrNull("base64")
                    if (base64 != null) {
                        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                        Pushizo.Chat.sendAttachment(bytes, fileName, mimeType, text, callback(reply) { it.toJson() })
                    } else {
                        Pushizo.Chat.sendAttachment(android.net.Uri.parse(args.requireString("uri")), fileName, mimeType, text, callback(reply) { it.toJson() })
                    }
                }
                "chatMarkRead" -> Pushizo.Chat.markRead(args.optLong("seq", 0L), callback(reply) { JSONObject().put("unreadCount", it) })
                "chatRefreshUnreadCount" -> Pushizo.Chat.refreshUnreadCount(callback(reply) { JSONObject().put("unreadCount", it) })
                "chatGetUnreadCount" -> reply.success(JSONObject().put("unreadCount", Pushizo.Chat.unreadCount))
                "chatLeaveOfflineMessage" -> Pushizo.Chat.leaveOfflineMessage(
                    args.requireString("email"), args.requireString("text"), args.optStringOrNull("name"), callback(reply) { it.toJson() },
                )
                "chatSetTyping" -> { Pushizo.Chat.setTyping(args.optBoolean("typing", false)); reply.success(null) }
                "chatStartListening" -> { Pushizo.Chat.startListening(); reply.success(null) }
                "chatStopListening" -> { Pushizo.Chat.stopListening(); reply.success(null) }
                "chatAttachmentUrl" -> reply.success(
                    JSONObject().put("url", Pushizo.Chat.attachmentUrl(args.requireString("attachmentId"), args.optBoolean("download", false))),
                )
                "chatGetVisitorId" -> reply.success(JSONObject().put("visitorId", Pushizo.Chat.visitorId.orNull()))
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
        private const val NOT_INITIALIZED = "Önce Pushizo.initialize çağrılmalı"
        private val LOCATION_PERMISSIONS = arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
        private const val LIVE_ACTIVITY_UNSUPPORTED_CODE = "PLATFORM_NOT_SUPPORTED"
        private const val LIVE_ACTIVITY_UNSUPPORTED_MESSAGE = "Live Activities yalnızca iOS'ta desteklenir"

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

        fun HsPreference.toJson(): JSONObject = JSONObject()
            .put("category", category)
            .put("channel", channel.orNull())
            .put("optedIn", optedIn)
            .put("explicit", explicit)
            .put("source", source.orNull())
            .put("updatedAt", updatedAt.orNull())

        fun HsMessageCategory.toJson(): JSONObject = JSONObject()
            .put("key", key)
            .put("name", JSONObject(name))
            .put("description", JSONObject(description))
            .put("channels", channels?.let { JSONArray(it) }.orNull())
            .put("defaultOptedIn", defaultOptedIn)

        fun HsPreferencesResult.toJson(): JSONObject = JSONObject()
            .put("preferences", JSONArray(preferences.map { it.toJson() }))
            .put("categories", JSONArray(categories.map { it.toJson() }))

        /** JS `{ category, channel, optedIn }[]` → SDK girdisi; kural denetimi (1-100, kanal) SDK'dadır. */
        fun JSONObject.preferenceInputs(key: String): List<HsPreferenceInput> {
            val arr = optJSONArray(key) ?: throw IllegalArgumentException("$key gerekli")
            return (0 until arr.length()).map { i ->
                val item = arr.optJSONObject(i) ?: throw IllegalArgumentException("$key[$i] nesne olmalı")
                HsPreferenceInput(item.requireString("category"), item.optStringOrNull("channel"), item.optBoolean("optedIn", false))
            }
        }

        private fun Any?.orNull(): Any = this ?: JSONObject.NULL

        fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key) else null

        fun JSONObject.optLongOrNull(key: String): Long? = if (has(key) && !isNull(key)) optLong(key) else null

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
