/*
 * Native köprü sözleşmesi: JS cephesinin çağırdığı her metodun Android (Kotlin) ve iOS (Swift)
 * köprülerinde karşılığı olmalı ve plugin.xml'in andığı dosyalar mevcut olmalı. Native kod bu ortamda
 * derlenemediğinden kaynak metni üzerinden doğrulanır.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
// Windows'ta `core.autocrlf` dosyaları CRLF ile çıkarır; sözleşme denetimi satır sonundan bağımsızdır.
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

/** Cephenin native'e gönderdiği metot adları. */
function facadeMethods(): Set<string> {
  const src = read('src/core.ts');
  return new Set([...src.matchAll(/bridge\.call(?:<[^>]*>)?\('([A-Za-z]+)'/g)].map((m) => m[1]));
}

describe('native sözleşme', () => {
  const methods = facadeMethods();
  // Adaptörde (Activity/izin API'si) ele alınanlar.
  const adapterHandled = new Set(['requestPermission', 'requestLocationPermission', 'requestBackgroundLocationPermission']);

  it('cephe beklenen metot kümesini kullanır', () => {
    expect(methods.size).toBeGreaterThan(30);
    expect(methods.has('initialize')).toBe(true);
    expect(methods.has('inboxList')).toBe(true);
  });

  it('Android çekirdeği her metodu karşılar', () => {
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    const handled = new Set([...kt.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    const plugin = read('src/android/com/pushizo/cordova/PushizoCordovaPlugin.kt');
    const pluginHandled = new Set([...plugin.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    for (const m of methods) {
      expect(handled.has(m) || (adapterHandled.has(m) && pluginHandled.has(m)), `Android: ${m}`).toBe(true);
    }
    expect(pluginHandled.has('setEventCallback')).toBe(true);
  });

  it('iOS çekirdeği ve Cordova seçicileri her metodu karşılar', () => {
    const swift = read('src/ios/PushizoBridgeCore.swift');
    const handled = new Set([...swift.matchAll(/case ((?:"[A-Za-z]+"(?:, )?)+):/g)].flatMap((m) => [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1])));
    const plugin = read('src/ios/PushizoCordovaPlugin.swift');
    const selectors = new Set([...plugin.matchAll(/@objc\(([A-Za-z]+):\)/g)].map((m) => m[1]));
    for (const m of methods) {
      expect(handled.has(m), `iOS çekirdek: ${m}`).toBe(true);
      expect(selectors.has(m), `iOS seçici: ${m}`).toBe(true);
    }
    expect(selectors.has('setEventCallback')).toBe(true);
  });

  it('bildirim kaldırma ve e-posta/SMS listeleri gerçek native SDK çağrılarına bağlı', () => {
    expect(methods.has('getContacts')).toBe(true);
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.Notifications.removeNotification(id)');
    expect(kt).toContain('JSONArray(Pushizo.User.emails)');
    expect(kt).toContain('JSONArray(Pushizo.User.smsNumbers)');
    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.Notifications.removeNotification(identifier: identifier)');
    expect(swift).toContain('Pushizo.Notifications.removeGroupedNotifications(group)');
    expect(swift).toContain('"emails": Pushizo.User.emails, "smsNumbers": Pushizo.User.smsNumbers');
    expect(swift).not.toMatch(/case "removeNotification": ok\(\)/);
  });

  it('JWT identity verification native SDK çağrılarına iletilir', () => {
    expect(methods.has('updateUserJwt')).toBe(true);
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))');
    expect(kt).toContain('Pushizo.updateUserJwt(args.requireString("jwt"))');
    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.login(externalId, identityHash: identityHash, jwt: jwt)');
    expect(swift).toContain('try Pushizo.updateUserJwt(jwt)');
  });

  it('Android teslimat güçlendirme: native Pushizo.Delivery çağrılarına bağlı; iOS zararsız yanıt verir', () => {
    for (const m of ['deliveryStatus', 'deliveryShouldShowGuidance', 'deliveryOpenSettings', 'deliveryShowGuidance']) {
      expect(methods.has(m), m).toBe(true);
    }
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('"deliveryStatus" -> reply.success(Pushizo.Delivery.status()?.toJson() ?: JSONObject().put("supported", false))');
    expect(kt).toContain('Pushizo.Delivery.shouldShowGuidance(args.optInt("minIntervalDays", 14))');
    expect(kt).toContain('Pushizo.Delivery.openSettings(activityProvider?.invoke() ?: context, deliverySetting(args.optStringOrNull("setting")))');
    expect(kt).toContain('Pushizo.Delivery.showGuidance(activity, deliverySetting(args.optStringOrNull("setting")), args.optStringOrNull("message")) { opened ->');
    // Activity yoksa diyalog gösterilmez; hata yerine false döner.
    expect(kt).toContain('if (activity == null) reply.success(JSONObject().put("opened", false))');
    // Köprü pil optimizasyonu iznini istemez (ADR-0092 §3).
    expect(kt).not.toContain('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(read('src/android/com/pushizo/cordova/PushizoCordovaPlugin.kt')).toContain('core.activityProvider = { cordova.activity }');
    // TS `DeliveryStatus` alanlarının tümü native JSON'da bulunur.
    const defs = read('src/definitions.ts');
    const fields = [...defs.slice(defs.indexOf('export interface DeliveryStatus {')).split('\n}')[0].matchAll(/^\s{2}([a-zA-Z]+): /gm)].map((m) => m[1]);
    expect(fields).toHaveLength(17);
    const json = kt.slice(kt.indexOf('fun HsDeliveryStatus.toJson()'), kt.indexOf('fun HsNotification.toJson()'));
    for (const field of fields) expect(json.includes(`.put("${field}", `), field).toBe(true);

    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('case "deliveryStatus": ok(["supported": false])');
    expect(swift).toContain('case "deliveryShouldShowGuidance": ok(["show": false])');
    expect(swift).toContain('case "deliveryOpenSettings", "deliveryShowGuidance": ok(["opened": false])');
  });

  it('Live Activities iOS SDK çağrılarına bağlı, Android PLATFORM_NOT_SUPPORTED ile reddeder', () => {
    expect(methods.has('setupDefaultLiveActivity')).toBe(true);
    expect(methods.has('startDefaultLiveActivity')).toBe(true);
    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('try Pushizo.LiveActivities.setupDefaultLiveActivity()');
    expect(swift).toContain('try Pushizo.LiveActivities.startDefaultLiveActivity(activityId:');
    expect(swift).toContain('catch let error as HSLiveActivityError');
    expect(swift).toContain('reply(.failure(code: error.code, message: error.message))');
    expect(swift).toContain('"LIVE_ACTIVITY_FAILED"');
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('"setupDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE');
    expect(kt).toContain('"startDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE');
    expect(kt).toContain('LIVE_ACTIVITY_UNSUPPORTED_CODE = "PLATFORM_NOT_SUPPORTED"');
    expect(kt).toContain('Live Activities yalnızca iOS\'ta desteklenir');
  });

  it('Konum: native SDK Location çağrılarına bağlı; Android izni manifest, açıklama ve cordova.requestPermissions akışıyla ister', () => {
    for (const m of ['setLocationShared', 'isLocationShared', 'requestLocationPermission']) expect(methods.has(m), m).toBe(true);
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('Pushizo.Location.setShared(args.optBoolean("shared", false))');
    expect(kt).toContain('"isLocationShared" -> reply.success(JSONObject().put("shared", Pushizo.Location.isShared))');
    expect(kt).toContain('JSONObject().put("permission", Pushizo.Location.permissionGranted)');
    expect(kt).toContain('Pushizo.Location.onPermissionResult()');
    // Yalnızca uygulama manifest'inde tanımlı konum izinleri istenir.
    expect(kt).toContain('PackageManager.GET_PERMISSIONS');
    expect(kt).toContain('arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)');
    // Açıklama diyaloğu SDK string kaynaklarıyla; "Şimdi değil"/iptal false döner.
    for (const key of ['title', 'message', 'continue', 'not_now']) {
      expect(kt).toContain(`com.pushizo.sdk.R.string.hs_location_rationale_${key}`);
    }
    expect(kt).toContain('.setOnCancelListener { reply.success(locationPermissionJson()) }');
    const plugin = read('src/android/com/pushizo/cordova/PushizoCordovaPlugin.kt');
    expect(plugin).toContain('core.requestLocationPermission(cordova.activity, args, reply(callbackContext))');
    expect(plugin).toContain('cordova.requestPermissions(this, Pushizo.Location.PERMISSION_REQUEST_CODE, permissions)');
    expect(plugin).toContain('Pushizo.Location.PERMISSION_REQUEST_CODE -> {');
    expect(plugin).toContain('val result = core.onLocationPermissionResult()');
    // Eklenti konum iznini manifest'e otomatik eklemez (README "Konum").
    expect(read('plugin.xml')).not.toMatch(/ACCESS_(COARSE|FINE|BACKGROUND)_LOCATION/);
    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.Location.setShared(args["shared"] as? Bool ?? false)');
    expect(swift).toContain('case "isLocationShared": ok(["shared": Pushizo.Location.isShared])');
    expect(swift).toContain('Pushizo.Location.requestPermission(rationale: string("rationale")) { granted in ok(["permission": granted]) }');
  });

  it('Bölge izleme, özellik bayrakları ve yerleşimler native SDK çağrılarına bağlı', () => {
    for (const m of [
      'setGeofencingEnabled', 'isGeofencingEnabled', 'featureFlagsRefresh', 'featureFlagsIsEnabled', 'featureFlagsGetValue',
      'placementsList', 'placementsReportImpression', 'placementsReportClick', 'placementsReportDismiss',
    ]) {
      expect(methods.has(m), m).toBe(true);
    }
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(kt).toContain('Pushizo.Location.setGeofencingEnabled(args.optBoolean("enabled", false))');
    expect(kt).toContain('"isGeofencingEnabled" -> reply.success(JSONObject().put("enabled", Pushizo.Location.isGeofencingEnabled))');
    expect(kt).toContain('"featureFlagsRefresh" -> Pushizo.FeatureFlags.refresh { ok -> reply.success(JSONObject().put("success", ok)) }');
    expect(kt).toContain('Pushizo.FeatureFlags.isEnabled(args.requireString("key"), args.optBoolean("defaultValue", false))');
    expect(kt).toContain('Pushizo.FeatureFlags.getValue(args.requireString("key")).orNull()');
    expect(kt).toContain('"placementsList" -> Pushizo.Placements.list(args.requireString("key"), args.optInt("limit", 1))');
    expect(kt).toContain('Pushizo.Placements.reportImpression(it)');
    expect(kt).toContain('Pushizo.Placements.reportClick(it, buttonId)');
    expect(kt).toContain('Pushizo.Placements.reportDismiss(it)');
    // Rapor çağrıları son `list` yanıtlarındaki mesajla yapılır (sınırlı önbellek); bulunamazsa yalnızca debug log.
    expect(kt).toContain('private const val MAX_PLACEMENT_CACHE = 50');
    expect(kt).toContain('HsLog.d("yerleşim mesajı bulunamadı: $id")');
    expect(kt).toContain('fun HsInAppMessage.toBridgeJson(): JSONObject');
    // Köprü arka plan konum iznini manifeste eklemez (ADR-0065 §2); izin `requestBackgroundLocationPermission` ile istenir.

    expect(swift).toContain('Pushizo.Location.setGeofencingEnabled(args["enabled"] as? Bool ?? false)');
    expect(swift).toContain('case "isGeofencingEnabled": ok(["enabled": Pushizo.Location.isGeofencingEnabled])');
    expect(swift).toContain('let success = await Pushizo.FeatureFlags.refresh()');
    expect(swift).toContain('Pushizo.FeatureFlags.isEnabled(key, default: args["defaultValue"] as? Bool ?? false)');
    expect(swift).toContain('ok(["value": Self.orNull(Pushizo.FeatureFlags.value(key))])');
    expect(swift).toContain('let messages = try await Pushizo.Placements.list(key, limit: limit)');
    expect(swift).toContain('Pushizo.Placements.reportImpression(message)');
    expect(swift).toContain('Pushizo.Placements.reportClick(message, buttonId: buttonId)');
    expect(swift).toContain('Pushizo.Placements.reportDismiss(message)');
    expect(swift).toContain('private static let maxPlacementCache = 50');
    expect(swift).toContain('static func map(_ m: HSInAppMessage) -> [String: Any]');
    expect(read('plugin.xml')).not.toContain('ACCESS_BACKGROUND_LOCATION');
  });

  it('yerel API eşitliği: profille login, reklam rızası, reklam kimliği, rozet, ADM, konum izni ve sohbet dinleme', () => {
    expect([...methods]).toEqual(
      expect.arrayContaining([
        'isInitialized', 'setAdsPersonalizationConsent', 'getConsents', 'registerAdm', 'setAdvertisingId', 'setBadgeCount',
        'getLocationPermission', 'requestBackgroundLocationPermission', 'chatIsListening',
      ]),
    );
    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    expect(kt).toContain('"isInitialized" -> reply.success(JSONObject().put("initialized", Pushizo.isInitialized))');
    // Profil yerel `login(externalId, HsUserProfile, identityHash, jwt)` aşırı yüklemesine gider (doğrulama girişten önce).
    expect(kt).toContain('val profile = args.optJSONObject("profile")');
    expect(kt).toMatch(/Pushizo\.login\(\s+args\.requireString\("externalId"\),\s+HsUserProfile\(/);
    for (const field of ['email = profile.optStringOrNull("email")', 'sms = profile.optStringOrNull("sms")', 'tags = profile.stringMap("tags")', 'aliases = profile.stringMap("aliases")']) {
      expect(kt).toContain(field);
    }
    expect(kt).toContain('Pushizo.User.setAdsPersonalizationConsent(args.optBoolean("granted", false), callback(reply) { it.toJson() })');
    expect(kt).toContain('Pushizo.User.getConsents(callback(reply) { list -> JSONObject().put("consents", JSONArray(list.map { it.toJson() })) })');
    const consentJson = kt.slice(kt.indexOf('fun HsConsent.toJson()'), kt.indexOf('fun HsPreferencesResult.toJson()'));
    for (const field of ['purpose', 'granted', 'source', 'updatedAt']) expect(consentJson.includes(`.put("${field}", `), field).toBe(true);
    expect(kt).toContain('Pushizo.User.registerAdm(args.requireString("token"))');
    expect(kt).toContain('Pushizo.Ads.setAdvertisingId(args.optStringOrNull("id"))');
    // Rozet yerel `Notifications.setBadgeCount` çağrısına bağlıdır; sonuç (rozet gösterilebiliyor mu) JS'e döner.
    expect(kt).toContain('"setBadgeCount" -> reply.success(JSONObject().put("success", Pushizo.Notifications.setBadgeCount(args.optInt("count", 0))))');
    expect(kt).toContain('JSONObject().put("permission", Pushizo.Location.permissionGranted).put("background", Pushizo.Location.backgroundPermissionGranted)');
    expect(kt).toContain('"chatIsListening" -> reply.success(JSONObject().put("listening", Pushizo.Chat.isListening))');
    // Arka plan izni: zaten varsa true; yalnızca manifest'te tanımlıysa istenir; vazgeçilirse yanıt askıda kalmaz.
    expect(kt).toContain('fun requestBackgroundLocationPermission(activity: Activity?, args: JSONObject, reply: Reply, requestSystem: (Array<String>) -> Unit)');
    expect(kt).toContain('if (Pushizo.Location.backgroundPermissionGranted) {');
    expect(kt).toContain('declaredPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))');
    expect(kt).toContain('val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q');
    for (const key of ['hs_geofence_rationale_title', 'hs_geofence_rationale_message']) expect(kt).toContain(`com.pushizo.sdk.R.string.${key}`);
    expect(kt).toContain('.setNegativeButton(com.pushizo.sdk.R.string.hs_location_rationale_not_now) { _, _ -> reply.success(backgroundLocationPermissionJson()) }');
    expect(kt).toContain('.setOnCancelListener { reply.success(backgroundLocationPermissionJson()) }');
    expect(kt).toContain('fun backgroundLocationPermissionJson(): JSONObject = JSONObject().put("permission", Pushizo.Location.backgroundPermissionGranted)');
    const plugin = read('src/android/com/pushizo/cordova/PushizoCordovaPlugin.kt');
    expect(plugin).toContain('"requestBackgroundLocationPermission" -> requestBackgroundLocationPermission(args.optJSONObject(0) ?: JSONObject(), callbackContext)');
    expect(plugin).toContain('core.requestBackgroundLocationPermission(cordova.activity, args, reply(callbackContext))');
    expect(plugin).toContain('cordova.requestPermissions(this, BACKGROUND_LOCATION_REQUEST_CODE, permissions)');
    expect(plugin).toContain('val result = core.onBackgroundLocationPermissionResult()');
    // Yanıtsız kalan önceki istek güncel izin durumuyla kapatılır.
    expect(plugin).toContain('previous?.success(core.backgroundLocationPermissionJson())');
    const selectors = read('src/ios/PushizoCordovaPlugin.swift');
    for (const m of ['isInitialized', 'setAdsPersonalizationConsent', 'getConsents', 'registerAdm', 'setAdvertisingId', 'setBadgeCount', 'getLocationPermission', 'requestBackgroundLocationPermission', 'chatIsListening']) {
      expect(selectors).toContain(`@objc(${m}:) func ${m}(_ command: CDVInvokedUrlCommand) { dispatch(command) }`);
    }
    // Köprü arka plan konum iznini manifest'e eklemez; uygulama tanımlar.
    expect(read('plugin.xml')).not.toContain('ACCESS_BACKGROUND_LOCATION');

    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('case "isInitialized": ok(["initialized": Pushizo.isInitialized])');
    // Profil yerel `login(_:profile:identityHash:jwt:)` aşırı yüklemesine gider: doğrulama ve sıralama yerel SDK'dadır,
    // köprü profil alanlarını kendisi yazmaz. `HSError.invalidArgument` → INVALID_ARGUMENT, başlatılmamış SDK → NOT_READY.
    const login = swift.slice(swift.indexOf('case "login":'), swift.indexOf('case "updateUserJwt":'));
    expect(login).toContain('try Pushizo.login(externalId, profile: userProfile, identityHash: identityHash, jwt: jwt)');
    expect(login).toContain('HSUserProfile(email: Self.nonBlank(profile["email"]), sms: Self.nonBlank(profile["sms"]),');
    expect(login).toContain('tags: Self.stringMap(profile["tags"]), aliases: Self.stringMap(profile["aliases"]))');
    expect(login).toMatch(/catch HSError\.invalidArgument\(let message\) \{\s+invalid\(message\)/);
    expect(login).toContain('reply(.failure(code: "NOT_READY", message: Self.notInitialized))');
    // Kanıt denetimi profilden önce yapılır (Android köprüsüyle aynı kod).
    expect(login.indexOf('Pushizo.loginProofError(identityHash: identityHash, jwt: jwt)')).toBeLessThan(login.indexOf('try Pushizo.login('));
    for (const call of ['HSContacts.normalize', 'Pushizo.User.addEmail', 'Pushizo.User.addSms', 'Pushizo.User.addTags', 'Pushizo.User.addAliases']) {
      expect(login.includes(call), call).toBe(false);
    }
    expect(swift).toContain('Self.map(try await Pushizo.User.setAdsPersonalizationConsent(granted))');
    expect(swift).toContain('["consents": try await Pushizo.User.getConsents().map { Self.map($0) }]');
    expect(swift).toContain('static func map(_ consent: HSUserConsent) -> [String: Any]');
    expect(swift).toContain('case "registerAdm": ok()');
    expect(swift).toContain('case "setAdvertisingId": Pushizo.Ads.setAdvertisingId(string("id")); ok()');
    expect(swift).toContain('Pushizo.Notifications.setBadgeCount(count); ok(["success": true])');
    // Konum izni durumu yerel SDK'dan okunur; köprünün kendi CLLocationManager uygulaması kaldırıldı.
    expect(swift).toContain('ok(["permission": Pushizo.Location.permissionGranted, "background": Pushizo.Location.backgroundPermissionGranted])');
    expect(swift).not.toContain('CLLocationManager');
    expect(swift).not.toContain('import CoreLocation');
    expect(swift).toContain('Pushizo.Location.requestAlwaysPermission { granted in ok(["permission": granted]) }');
    expect(swift).toContain('case "chatIsListening": ok(["listening": Pushizo.Chat.isListening])');
  });

  it('köprü turu 3: kullanıcı özelliği, gözlemciler, rozet, eventId ve hazır sohbet ekranı yerel SDK çağrılarına bağlı', () => {
    for (const m of ['setUserProperty', 'getBadgeCount', 'chatShow', 'chatHide', 'chatIsPresented']) expect(methods.has(m), m).toBe(true);
    const core = read('src/core.ts');
    for (const event of ['featureFlagsChange', 'inboxChange']) expect(core).toContain(`case '${event}':`);

    const kt = read('src/android/com/pushizo/cordova/PushizoBridgeCore.kt');
    // Kullanıcı özelliği: JSON null → null (siler); boş anahtar yerel SDK'da IllegalArgumentException → INVALID_ARGUMENT.
    expect(kt).toContain('Pushizo.User.setProperty(args.requireString("key"), args.opt("value")?.takeUnless { it == JSONObject.NULL })');
    // Gözlemciler bir kez eklenir, `detach` ile kaldırılır.
    expect(kt).toContain('private val featureFlagObserver = HsFeatureFlagObserver { emit("featureFlagsChange", JSONObject()) }');
    expect(kt).toContain('private val inboxObserver = HsInboxObserver { event -> emit("inboxChange", JSONObject(event.toMap())) }');
    for (const call of ['Pushizo.FeatureFlags.addObserver(featureFlagObserver)', 'Pushizo.FeatureFlags.removeObserver(featureFlagObserver)', 'Pushizo.Inbox.addObserver(inboxObserver)', 'Pushizo.Inbox.removeObserver(inboxObserver)']) {
      expect(kt).toContain(call);
    }
    expect(kt).toContain('"getBadgeCount" -> reply.success(JSONObject().put("count", Pushizo.Notifications.badgeCount))');
    // eventId verilmediyse eski aşırı yükleme, verildiyse `sendEvent(name, properties, value, eventId)`.
    expect(kt).toContain('if (eventId == null) Pushizo.Session.sendEvent(name, properties, value) else Pushizo.Session.sendEvent(name, properties, value, eventId)');
    // Hazır sohbet ekranı: etkin Activity tercih edilir; başlatılmamış SDK NOT_READY.
    const show = kt.slice(kt.indexOf('"chatShow" ->'), kt.indexOf('"chatHide" ->'));
    expect(show).toContain('check(Pushizo.isInitialized) { NOT_INITIALIZED }');
    expect(show).toContain('Pushizo.Chat.show(activityProvider?.invoke() ?: context)');
    expect(kt).toContain('"chatHide" -> { Pushizo.Chat.hide(); reply.success(null) }');
    // Yerel Android SDK `isPresented` sunmaz: köprü `HsChatActivity` yaşam döngüsünü izler.
    expect(kt).toContain('"chatIsPresented" -> reply.success(JSONObject().put("presented", isChatPresented()))');
    expect(kt).toContain('if (activity is HsChatActivity) synchronized(chatScreens) { chatScreens.add(activity) }');
    expect(kt).toContain('if (activity is HsChatActivity) synchronized(chatScreens) { chatScreens.remove(activity) }');
    expect(kt).toContain('registerActivityLifecycleCallbacks(chatScreenTracker)');
    expect(kt).toContain('unregisterActivityLifecycleCallbacks(chatScreenTracker)');

    const swift = read('src/ios/PushizoBridgeCore.swift');
    expect(swift).toContain('Pushizo.User.setProperty(key, args["value"]); ok()');
    expect(swift).toMatch(/Pushizo\.FeatureFlags\.addObserver \{\s+Self\.active\?\.emit\("featureFlagsChange", \[:\]\)/);
    expect(swift).toMatch(/Pushizo\.Inbox\.addObserver \{ event in\s+Self\.active\?\.emit\("inboxChange", event\.dictionary\)/);
    expect(swift).toContain('DispatchQueue.main.async { ok(["count": UIApplication.shared.applicationIconBadgeNumber]) }');
    expect(swift).toContain('value: (args["value"] as? NSNumber)?.doubleValue, eventId: string("eventId"))');
    const iosShow = swift.slice(swift.indexOf('case "chatShow":'), swift.indexOf('case "chatHide":'));
    expect(iosShow).toContain('guard Pushizo.isInitialized else { reply(.failure(code: "NOT_READY", message: Self.notInitialized)); return true }');
    expect(iosShow).toContain('Pushizo.Chat.show(); ok()');
    expect(swift).toContain('case "chatHide": Pushizo.Chat.hide(); ok()');
    expect(swift).toContain('DispatchQueue.main.async { ok(["presented": Pushizo.Chat.isPresented]) }');
    // Cordova: yeni metotlar çekirdek işleyicisine düşer (Android `else -> core.handle`), iOS'ta seçici olarak tanımlıdır.
    const selectors = read('src/ios/PushizoCordovaPlugin.swift');
    for (const m of ['setUserProperty', 'getBadgeCount', 'chatShow', 'chatHide', 'chatIsPresented']) {
      expect(selectors).toContain(`@objc(${m}:) func ${m}(_ command: CDVInvokedUrlCommand) { dispatch(command) }`);
    }
    expect(read('src/android/com/pushizo/cordova/PushizoCordovaPlugin.kt')).toContain('else -> return core.handle(action, args.optJSONObject(0) ?: JSONObject(), reply(callbackContext))');
  });

  it('yerel SDK bağımlılıkları bayrak/yerleşim/bölge izleme sunan sürümlerde (Android 0.2.1, iOS 0.2)', () => {
    const xml = read('plugin.xml');
    expect(xml).toContain('<framework src="com.pushizo:pushizo-android:0.2.1" />');
    expect(xml).toContain('<pod name="Pushizo" spec="~> 0.2" />');
    expect((JSON.parse(read('package.json')) as { version: string }).version).toBe('0.2.0');
  });

  it('plugin.xml dosya başvuruları mevcut', () => {
    const xml = read('plugin.xml');
    const refs = [...xml.matchAll(/<(?:js-module|source-file|framework)[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.includes(':'));
    expect(refs.length).toBeGreaterThan(8);
    for (const ref of refs) expect(existsSync(join(root, ref)), ref).toBe(true);
    expect(xml).toContain('com.pushizo.cordova.PushizoCordovaPlugin');
    expect(xml).toContain('<param name="ios-package" value="PushizoCordovaPlugin" />');
  });

  it('package.json sürümü plugin.xml ile aynı', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(read('plugin.xml')).toContain(`id="cordova-plugin-pushizo"\n        version="${pkg.version}"`);
  });
});
