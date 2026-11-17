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
import com.pushizo.sdk.HsConsent
import com.pushizo.sdk.HsForegroundEvent
import com.pushizo.sdk.HsInAppAction
import com.pushizo.sdk.HsInAppBlock
import com.pushizo.sdk.HsInAppCarouselCard
import com.pushizo.sdk.HsInAppClickEvent
import com.pushizo.sdk.HsInAppDisplay
import com.pushizo.sdk.HsInAppLifecycleEvent
import com.pushizo.sdk.HsInAppLifecycleListener
import com.pushizo.sdk.HsInAppMessage
import com.pushizo.sdk.HsInAppTrigger
import com.pushizo.sdk.HsContentCard
import com.pushizo.sdk.HsContentCardFeed
import com.pushizo.sdk.HsDeliverySetting
import com.pushizo.sdk.HsDeliveryStatus
import com.pushizo.sdk.HsInboxItem
import com.pushizo.sdk.HsInboxPage
import com.pushizo.sdk.HsLog
import com.pushizo.sdk.HsMessageCategory
import com.pushizo.sdk.HsNotification
import com.pushizo.sdk.HsPreference
import com.pushizo.sdk.HsPreferenceInput
import com.pushizo.sdk.HsPreferencesResult
import com.pushizo.sdk.HsPushSubscriptionState
import com.pushizo.sdk.HsUserProfile
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

    /** Köprünün etkin Activity'si (teslimat ayar ekranı ve açıklama diyaloğu için); köprü sınıfı atar, yoksa null döner. */
    @Volatile var activityProvider: (() -> Activity?)? = null

    private val listenersRegistered = AtomicBoolean(false)
    private val foregroundSeq = AtomicLong(0)

    /** Karar bekleyen ön plan bildirimleri; en eski kayıtlar düşürülür (sınırlı bellek). */
    private val pendingForeground = object : LinkedHashMap<String, HsForegroundEvent>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, HsForegroundEvent>?): Boolean = size > MAX_PENDING_FOREGROUND
    }

    /** Son `placementsList` yanıtlarındaki mesajlar (kimliğe göre); raporlar bu nesnelerle yapılır, en eski kayıtlar düşürülür. */
    private val placementMessages = object : LinkedHashMap<String, HsInAppMessage>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, HsInAppMessage>?): Boolean = size > MAX_PLACEMENT_CACHE
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

    /**
     * Arka plan konum izni akışı (bölge izleme, ADR-0065): Android SDK'nın `Location.requestBackgroundPermission` sonucu
     * geri çağrıyla bildirilmediğinden köprü aynı adımları kendi izin mekanizmasıyla yürütür. İzin zaten varsa true.
     * Android 10 öncesinde arka plan izni ayrı değildir: normal konum izinleri istenir. Android 10+ için uygulama
     * manifest'inde `ACCESS_BACKGROUND_LOCATION` yoksa veya Activity yoksa false. Değilse açıklama diyaloğu gösterilir;
     * "Şimdi değil"/iptal false döner, "Devam" ise [requestSystem] ile sistem izni istenir (Android 11+ Ayarlar ekranı
     * açılır) — sonuç geldiğinde köprü [onBackgroundLocationPermissionResult] yanıtını döndürür.
     */
    fun requestBackgroundLocationPermission(activity: Activity?, args: JSONObject, reply: Reply, requestSystem: (Array<String>) -> Unit) {
        if (!Pushizo.isInitialized) {
            reply.error("NOT_READY", NOT_INITIALIZED)
            return
        }
        if (Pushizo.Location.backgroundPermissionGranted) {
            reply.success(onBackgroundLocationPermissionResult())
            return
        }
        val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        val permissions = if (legacy) declaredLocationPermissions() else declaredPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        if (permissions.isEmpty()) {
            HsLog.w(
                if (legacy) "konum izni istenemedi: uygulama manifest'inde ACCESS_COARSE_LOCATION/ACCESS_FINE_LOCATION yok"
                else "arka plan konum izni istenemedi: uygulama manifest'inde ACCESS_BACKGROUND_LOCATION yok",
            )
            reply.success(backgroundLocationPermissionJson())
            return
        }
        if (activity == null || activity.isFinishing || activity.isDestroyed) {
            HsLog.w("arka plan konum izni istenemedi: etkin Activity yok")
            reply.success(backgroundLocationPermissionJson())
            return
        }
        val rationale = args.optStringOrNull("rationale")?.takeIf { it.isNotBlank() }
        val title = if (legacy) com.pushizo.sdk.R.string.hs_location_rationale_title else com.pushizo.sdk.R.string.hs_geofence_rationale_title
        val message = if (legacy) com.pushizo.sdk.R.string.hs_location_rationale_message else com.pushizo.sdk.R.string.hs_geofence_rationale_message
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed) {
                reply.success(backgroundLocationPermissionJson())
                return@runOnUiThread
            }
            AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(rationale ?: activity.getString(message))
                .setPositiveButton(com.pushizo.sdk.R.string.hs_location_rationale_continue) { _, _ -> requestSystem(permissions) }
                .setNegativeButton(com.pushizo.sdk.R.string.hs_location_rationale_not_now) { _, _ -> reply.success(backgroundLocationPermissionJson()) }
                .setOnCancelListener { reply.success(backgroundLocationPermissionJson()) }
                .show()
        }
    }

    /** Sistem izin sonucu: SDK bilgilendirilir (bölge izleme açıksa bölgeler yenilenir), güncel arka plan izni döner. */
    fun onBackgroundLocationPermissionResult(): JSONObject {
        Pushizo.Location.onPermissionResult()
        return backgroundLocationPermissionJson()
    }

    fun backgroundLocationPermissionJson(): JSONObject = JSONObject().put("permission", Pushizo.Location.backgroundPermissionGranted)

    /** Uygulama manifest'inde tanımlı konum izinleri (eklenti izinleri otomatik eklemez; README "Konum"). */
    private fun declaredLocationPermissions(): Array<String> = declaredPermissions(LOCATION_PERMISSIONS)

    /** [candidates] içinden uygulama manifest'inde tanımlı olanlar. */
    private fun declaredPermissions(candidates: Array<String>): Array<String> {
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
        return candidates.filter { it in requested }.toTypedArray()
    }

    /**
     * Metodu çalıştırır. Bilinmeyen metotta false döner. `requestPermission`, `requestLocationPermission` ve
     * `requestBackgroundLocationPermission` Activity gerektirdiğinden köprü sınıfında ele alınır.
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
                "isInitialized" -> reply.success(JSONObject().put("initialized", Pushizo.isInitialized))
                "login" -> {
                    // Profil (isteğe bağlı): geçersiz e-posta/telefon yerel SDK'da girişten önce reddedilir (INVALID_ARGUMENT).
                    val profile = args.optJSONObject("profile")
                    if (profile == null) {
                        Pushizo.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))
                    } else {
                        Pushizo.login(
                            args.requireString("externalId"),
                            HsUserProfile(
                                email = profile.optStringOrNull("email"),
                                sms = profile.optStringOrNull("sms"),
                                tags = profile.stringMap("tags"),
                                aliases = profile.stringMap("aliases"),
                            ),
                            args.optStringOrNull("identityHash"),
                            args.optStringOrNull("jwt"),
                        )
                    }
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
                // Reklam kişiselleştirme rızası (ADR-0037): tercih ucundaki ayrılmış `ads_personalization` anahtarı.
                "setAdsPersonalizationConsent" -> Pushizo.User.setAdsPersonalizationConsent(args.optBoolean("granted", false), callback(reply) { it.toJson() })
                "getConsents" -> Pushizo.User.getConsents(callback(reply) { list -> JSONObject().put("consents", JSONArray(list.map { it.toJson() })) })
                // Fire OS ADM kayıt kimliği; geçersiz kimlik → IllegalArgumentException → INVALID_ARGUMENT.
                "registerAdm" -> { Pushizo.User.registerAdm(args.requireString("token")); reply.success(null) }
                // Reklam kimliği (GAID): null veya sıfır kimlik sunucudaki kaydı siler.
                "setAdvertisingId" -> { Pushizo.Ads.setAdvertisingId(args.optStringOrNull("id")); reply.success(null) }

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
                // Uygulama rozeti iOS'a özgüdür; Android'de rozet görünen bildirimlerden hesaplanır: etkisiz, hata yok.
                "setBadgeCount" -> reply.success(null)
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
                "contentCardsList" -> Pushizo.ContentCards.list(args.optInt("limit", 50), callback(reply) { it.toJson() })
                "contentCardEvent" -> contentCardEvent(args.requireString("id"), args.optStringOrNull("event"), reply)

                // Konum (v2 Faz 17b): izin isteği Activity gerektirdiğinden köprü sınıfında ele alınır.
                "setLocationShared" -> {
                    check(Pushizo.isInitialized) { NOT_INITIALIZED }
                    Pushizo.Location.setShared(args.optBoolean("shared", false))
                    reply.success(null)
                }
                "isLocationShared" -> reply.success(JSONObject().put("shared", Pushizo.Location.isShared))
                "getLocationPermission" -> reply.success(
                    JSONObject().put("permission", Pushizo.Location.permissionGranted).put("background", Pushizo.Location.backgroundPermissionGranted),
                )
                // Arka plan bölge izleme (ADR-0065): varsayılan kapalı; köprü izin istemez, manifest'e izin eklemez.
                "setGeofencingEnabled" -> {
                    check(Pushizo.isInitialized) { NOT_INITIALIZED }
                    Pushizo.Location.setGeofencingEnabled(args.optBoolean("enabled", false))
                    reply.success(null)
                }
                "isGeofencingEnabled" -> reply.success(JSONObject().put("enabled", Pushizo.Location.isGeofencingEnabled))

                // Android teslimat güçlendirme (ADR-0092): teşhis, ayar ekranı adayları ve diyalog yerel SDK'dadır; çağrılar istisna atmaz.
                "deliveryStatus" -> reply.success(Pushizo.Delivery.status()?.toJson() ?: JSONObject().put("supported", false))
                "deliveryShouldShowGuidance" -> reply.success(
                    JSONObject().put(
                        "show",
                        if (args.has("minIntervalDays")) Pushizo.Delivery.shouldShowGuidance(args.optInt("minIntervalDays", 14)) else Pushizo.Delivery.shouldShowGuidance(),
                    ),
                )
                "deliveryOpenSettings" -> reply.success(
                    JSONObject().put("opened", Pushizo.Delivery.openSettings(activityProvider?.invoke() ?: context, deliverySetting(args.optStringOrNull("setting")))),
                )
                "deliveryShowGuidance" -> {
                    // Diyalog etkin bir Activity ister; yoksa hiçbir şey gösterilmez ve false döner.
                    val activity = activityProvider?.invoke()
                    if (activity == null) reply.success(JSONObject().put("opened", false))
                    else Pushizo.Delivery.showGuidance(activity, deliverySetting(args.optStringOrNull("setting")), args.optStringOrNull("message")) { opened ->
                        reply.success(JSONObject().put("opened", opened))
                    }
                }

                // Özellik bayrakları (ADR-0066): değerler yerel SDK önbelleğinden okunur; `refresh` geri çağrısı arka plan iş parçacığındadır.
                "featureFlagsRefresh" -> Pushizo.FeatureFlags.refresh { ok -> reply.success(JSONObject().put("success", ok)) }
                "featureFlagsIsEnabled" -> reply.success(
                    JSONObject().put("enabled", Pushizo.FeatureFlags.isEnabled(args.requireString("key"), args.optBoolean("defaultValue", false))),
                )
                "featureFlagsGetValue" -> reply.success(JSONObject().put("value", Pushizo.FeatureFlags.getValue(args.requireString("key")).orNull()))

                // Gömülü yerleşimler (ADR-0068): anahtar ve limit denetimi yerel SDK'dadır (IllegalArgumentException → INVALID_ARGUMENT).
                "placementsList" -> Pushizo.Placements.list(args.requireString("key"), args.optInt("limit", 1)) { messages ->
                    synchronized(placementMessages) {
                        messages.forEach { placementMessages.remove(it.id); placementMessages[it.id] = it }
                    }
                    reply.success(JSONObject().put("messages", JSONArray(messages.map { it.toBridgeJson() })))
                }
                "placementsReportImpression" -> { placementMessage(args)?.let { Pushizo.Placements.reportImpression(it) }; reply.success(null) }
                "placementsReportClick" -> {
                    val buttonId = args.requireString("buttonId")
                    placementMessage(args)?.let { Pushizo.Placements.reportClick(it, buttonId) }
                    reply.success(null)
                }
                "placementsReportDismiss" -> { placementMessage(args)?.let { Pushizo.Placements.reportDismiss(it) }; reply.success(null) }

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
                "chatIsListening" -> reply.success(JSONObject().put("listening", Pushizo.Chat.isListening))
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

    /** Rapor için mesajı son `placementsList` yanıtlarından bulur; bulunamazsa yok sayılır (yalnızca debug log). */
    private fun placementMessage(args: JSONObject): HsInAppMessage? {
        val id = args.requireString("id")
        return synchronized(placementMessages) { placementMessages[id] } ?: run {
            HsLog.d("yerleşim mesajı bulunamadı: $id")
            null
        }
    }

    /** SDK geri çağrısını köprü yanıtına çevirir; API hatasında sunucu kodu korunur. */
    // Kart olayı (ADR-0082): olay adı yerel SDK çağrısına eşlenir; bilinmeyen olay INVALID_ARGUMENT.
    private fun contentCardEvent(id: String, event: String?, reply: Reply) {
        val cb = callback<HsContentCard>(reply) { it.toJson() }
        if (event == "impression") Pushizo.ContentCards.logImpression(id, cb)
        else if (event == "click") Pushizo.ContentCards.logClick(id, cb)
        else if (event == "dismiss") Pushizo.ContentCards.dismiss(id, cb)
        else reply.error("INVALID_ARGUMENT", "Kart olayı impression, click veya dismiss olmalı.")
    }

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
        private const val MAX_PLACEMENT_CACHE = 50
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

        /** JS değeri (`auto`, `notifications`, `auto_start`, `battery_optimization`, `app_details`); tanınmayan değer `AUTO`. */
        fun deliverySetting(wire: String?): HsDeliverySetting =
            HsDeliverySetting.values().firstOrNull { it.name.equals(wire, ignoreCase = true) } ?: HsDeliverySetting.AUTO

        /** Teslim durumu (ADR-0092); enum değerleri küçük harfle (`risk`: none/elevated/high, ayarlar: `auto_start` …). */
        fun HsDeliveryStatus.toJson(): JSONObject = JSONObject()
            .put("supported", true)
            .put("manufacturer", manufacturer)
            .put("brand", brand)
            .put("vendor", vendor.id)
            .put("aggressiveVendor", vendor.aggressive)
            .put("rom", rom)
            .put("romVersion", romVersion.orNull())
            .put("notificationsEnabled", notificationsEnabled)
            .put("channelBlocked", channelBlocked)
            .put("batteryOptimizationExempt", batteryOptimizationExempt)
            .put("backgroundRestricted", backgroundRestricted)
            .put("standbyBucket", standbyBucket?.id.orNull())
            .put("powerSaveMode", powerSaveMode)
            .put("dataSaverEnabled", dataSaverEnabled)
            .put("restricted", restricted)
            .put("risk", risk.name.lowercase())
            .put("recommendedSettings", JSONArray(recommendedSettings.map { it.name.lowercase() }))

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

        fun HsContentCard.toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("messageId", messageId.orNull())
            .put("type", type.wire)
            .put("title", title.orNull())
            .put("body", body.orNull())
            .put("url", url.orNull())
            .put("imageUrl", imageUrl.orNull())
            .put("buttonText", buttonText.orNull())
            .put("data", JSONObject(data))
            .put("pinned", pinned)
            .put("priority", priority)
            .put("viewed", viewed)
            .put("clicked", clicked)
            .put("expiresAt", expiresAt.orNull())
            .put("createdAt", createdAt.orNull())

        fun HsContentCardFeed.toJson(): JSONObject = JSONObject()
            .put("cards", JSONArray(cards.map { it.toJson() }))
            .put("unviewedCount", unviewedCount)

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

        /** Rıza kaydı (ADR-0037); `updatedAt` epoch milisaniye. */
        fun HsConsent.toJson(): JSONObject = JSONObject()
            .put("purpose", purpose)
            .put("granted", granted)
            .put("source", source.orNull())
            .put("updatedAt", updatedAt.orNull())

        fun HsPreferencesResult.toJson(): JSONObject = JSONObject()
            .put("preferences", JSONArray(preferences.map { it.toJson() }))
            .put("categories", JSONArray(categories.map { it.toJson() }))

        // In-app mesaj modeli → JS `InAppMessage` (alanlar yerel modelle aynı; zamanlar epoch milisaniye).
        fun HsInAppMessage.toBridgeJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("priority", priority)
            .put("triggers", JSONArray(triggers.map { it.toJson() }))
            .put("triggerGroups", JSONArray(triggerGroups.map { group -> JSONArray(group.map { it.toJson() }) }))
            .put("variantId", variantId.orNull())
            .put("display", display.toJson())
            .put("remainingImpressions", remainingImpressions)
            .put("minIntervalSeconds", minIntervalSeconds)
            .put("stopAfterInteraction", stopAfterInteraction)
            .put("lastImpressionAt", lastImpressionAt.orNull())
            .put("endAt", endAt.orNull())
            .put("language", language.orNull())

        fun HsInAppDisplay.toJson(): JSONObject = JSONObject()
            .put("layout", layout.wire)
            .put("backgroundColor", backgroundColor.orNull())
            .put("textColor", textColor.orNull())
            .put("dismissible", dismissible)
            .put("autoDismissSeconds", autoDismissSeconds.orNull())
            .put("contentType", contentType.wire)
            .put("blocks", JSONArray(blocks.map { it.toJson() }))
            .put("html", html.orNull())
            .put("htmlHeight", htmlHeight.orNull())

        fun HsInAppTrigger.toJson(): JSONObject = when (this) {
            HsInAppTrigger.SessionStart -> JSONObject().put("kind", "session_start")
            is HsInAppTrigger.Event -> JSONObject().put("kind", "event").put("name", name)
            is HsInAppTrigger.Screen -> JSONObject().put("kind", "screen").put("name", name)
            is HsInAppTrigger.Condition -> JSONObject().put("kind", "trigger").put("key", key).put("op", op).put("value", value.orNull())
            is HsInAppTrigger.SessionDuration -> JSONObject().put("kind", "session_duration").put("seconds", seconds)
            is HsInAppTrigger.Unsupported -> JSONObject().put("kind", "unsupported").put("name", kind)
        }

        fun HsInAppAction.toJson(): JSONObject = when (this) {
            HsInAppAction.Dismiss -> JSONObject().put("type", "dismiss")
            is HsInAppAction.Url -> JSONObject().put("type", "url").put("url", url)
            is HsInAppAction.Deeplink -> JSONObject().put("type", "deeplink").put("url", url)
            is HsInAppAction.Tags -> JSONObject().put("type", "tags").put("tags", JSONObject(tags))
            HsInAppAction.PushPrompt -> JSONObject().put("type", "push_prompt")
            is HsInAppAction.Outcome -> JSONObject().put("type", "outcome").put("name", name).put("value", value.orNull())
        }

        fun HsInAppBlock.Button.toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("text", text)
            .put("action", action.toJson())
            .put("backgroundColor", backgroundColor.orNull())
            .put("textColor", textColor.orNull())

        fun HsInAppCarouselCard.toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("body", body.orNull())
            .put("imageUrl", imageUrl.orNull())
            .put("imageAlt", imageAlt.orNull())
            .put("button", button?.toJson().orNull())

        fun HsInAppBlock.toJson(): JSONObject = when (this) {
            is HsInAppBlock.Image -> JSONObject().put("type", "image").put("url", url).put("alt", alt.orNull())
            is HsInAppBlock.Title -> JSONObject().put("type", "title").put("text", text)
            is HsInAppBlock.Body -> JSONObject().put("type", "body").put("text", text)
            is HsInAppBlock.Button -> toJson().put("type", "button")
            is HsInAppBlock.Carousel -> JSONObject().put("type", "carousel").put("id", id).put("cards", JSONArray(cards.map { it.toJson() }))
        }

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
