# cordova-plugin-herosignal

HeroSignal'in Cordova eklentisi. Native HeroSignal Android (`com.herosignal:herosignal-android`) ve iOS (`HeroSignal` pod) SDK'larını `cordova.exec` köprüsüyle sarar. API yüzeyi plan 06 §6.1, eski sağlayıcı v5 ve `@herosignal/capacitor` ile aynıdır.

- cordova ≥ 12, cordova-android ≥ 12 (minSdk 24), cordova-ios ≥ 7 (iOS 15+)
- Push aboneliği (FCM/APNs), izin istemi ve izin gözlemcisi
- Bildirim tıklaması (soğuk başlatma dahil), ön plan gösterimini engelleme/erteleme
- Kullanıcı: `login`/`logout` (`identityHash`), tag, alias, dil, e-posta ve SMS aboneliği
- In-app mesajlar (tetik, ekran, duraklatma, tıklama ve yaşam döngüsü olayları; native çizim)
- Bildirim kutusu, özel olay, KVKK/GDPR gizlilik onayı, günlük seviyesi, bildirim tepsisini temizleme

## Kurulum

```bash
cordova plugin add cordova-plugin-herosignal
# monorepo içinden:
cordova plugin add ../../sdk/cordova
```

Eklenti JS'i `window.HeroSignal` ve `window.plugins.HeroSignal` olarak yüklenir. TypeScript için tipler pakettedir (`types/index.d.ts`).

## Kullanım

```js
document.addEventListener('deviceready', async () => {
  // Tıklama dinleyicisini erken ekleyin; uygulama bildirimden açıldıysa tıklama ilk dinleyiciye teslim edilir.
  HeroSignal.Notifications.addClickListener((event) => {
    console.log(event.notification.title, event.result.actionId, event.result.url);
  });

  await HeroSignal.initialize('app_xxx', { apiUrl: 'https://api.herosignal.dev', logLevel: 'warn' });
  await HeroSignal.Notifications.requestPermission();
  await HeroSignal.login('user_42');                    // identity verification açıksa: login('user_42', identityHash)
  await HeroSignal.User.addTags({ plan: 'pro', level: 3 });
  await HeroSignal.User.addEmail('ali@example.com');
  await HeroSignal.Session.sendEvent('purchase', { sku: 'A1' }, 49.9);
});
```

Tüm metotlar Promise döndürür. Hatalar `HeroSignalError` örneğidir ve `code` alanı taşır: `INVALID_ARGUMENT`, `NOT_READY`, `NOT_FOUND`, `NOT_IMPLEMENTED` veya sunucu hata kodu.

### JWT ile kimlik doğrulama

App ayarlarında kimlik doğrulama kipi (`identity_verification_mode`) `jwt` veya `both` ise kullanıcı, sunucunuzda
imzalanmış kısa ömürlü bir ES256 JWT ile kimliklendirilir (ADR-0023 §9; talepler: `sub` = external_id, `aud` = app_id, `exp`/`iat` zorunlu, en çok 24 saat, yalnızca ES256).

```js
await HeroSignal.login('user_42', { jwt: jwtFromBackend });                  // yalnızca JWT
await HeroSignal.login('user_42', { identityHash: hmac, jwt: jwtFromBackend }); // both kipinde ikisi birlikte
await HeroSignal.updateUserJwt(refreshedJwt); // süresi dolmadan yenileyin
await HeroSignal.logout();
```

- JWT yerel SDK'da identity hash ile aynı kalıcı depoda saklanır ve tüm `/sdk/v1/...` isteklerinde
  `Authorization: Bearer <jwt>` başlığıyla gider; gövdeye/URL'ye yazılmaz, loglanmaz. `logout` belirteci siler.
- `/config` yanıtında `identity_verification_required` true ise login öncesi kanıt denetlenir: `jwt` kipinde JWT, `hmac`
  kipinde `identityHash` zorunludur, `both` kipinde biri yeter; eksikse `login` `NOT_READY` ile reddedilir. Alan gelmeyen
  eski sunucularda kip `hmac` sayılır; ikinci argümanı metin olan eski `login(id, identityHash)` çağrıları aynen çalışır.
- `updateUserJwt` giriş yapılmamışsa `NOT_READY` ile reddedilir; başarıda kuyrukta bekleyen işlemler yeni belirteçle
  yeniden denenir.

### Live Activities (iOS)

Köprü, iOS SDK'nın genel `HeroSignalDefaultLiveActivityAttributes` türünü kullanır (ADR-0024; ayrıntı
`docs/sdk/ios.md` "Live Activities"). Sunucu etkinliği uzaktan başlatır (push-to-start, iOS 17.2+), günceller ve bitirir;
yerel başlatma iOS 16.1+ ister.

```js
await HeroSignal.initialize('app_xxx');
await HeroSignal.LiveActivities.setupDefaultLiveActivity(); // her açılışta: belirteçler sunucuya kaydedilir
await HeroSignal.LiveActivities.startDefaultLiveActivity(
  'order_42',                       // 1-100 karakter: harf, rakam, _ . : -
  { title: 'Sipariş #42' },         // attributes ('herosignal' anahtarı ayrılmıştır)
  { status: 'Yolda', eta: 12 },     // contentState
);
```

- Değerler metin, sonlu sayı veya boolean; anahtarlar 1-64 karakter. Kurala uymayan girdi köprüye gitmeden `TypeError`/
  `RangeError` fırlatır.
- Hata kodları (`HeroSignalError.code`): `PLATFORM_NOT_SUPPORTED` (iOS 16.1 öncesi; Android'de her zaman), `NOT_READY`
  (`initialize` yok), `INVALID_ARGUMENT`, `LIVE_ACTIVITY_FAILED` (Live Activities kapalı, `NSSupportsLiveActivities` yok,
  sistem sınırı).
- Xcode: uygulamanın Info.plist'ine `NSSupportsLiveActivities = YES` ekleyin; **Widget Extension** hedefi oluşturun ve
  hedefe SPM'de `HeroSignalExtension` ürününü (`import HeroSignalExtension`), CocoaPods'ta `pod 'HeroSignal/Extension'`
  (`import HeroSignal`) ekleyin:

```swift
ActivityConfiguration(for: HeroSignalDefaultLiveActivityAttributes.self) { context in
    VStack {
        Text(context.attributes.data["title"]?.stringValue ?? "")
        Text(context.state.data["status"]?.description ?? "")
    }
} dynamicIsland: { context in
    DynamicIsland { DynamicIslandExpandedRegion(.center) { Text(context.state.data["status"]?.description ?? "") } }
        compactLeading: { EmptyView() } compactTrailing: { Text(context.state.data["eta"]?.description ?? "") } minimal: { EmptyView() }
}
```

- Dashboard'da (**Live Activities**) veya API'de tür adı tam olarak `HeroSignalDefaultLiveActivityAttributes` olmalıdır.
  Sunucu: `POST /v1/apps/{appId}/live-activities/HeroSignalDefaultLiveActivityAttributes/start` (`activity_id`,
  `attributes`, `content_state`, `target`), `…/update` ve `…/end` (`activity_id`, `content_state`).
- Tip-güvenli kendi türünüz için native tarafta `HeroSignal.LiveActivities.register(MyAttributes.self)` kullanın.

### Olaylar

```js
HeroSignal.Notifications.addForegroundLifecycleListener((event) => {
  event.preventDefault();        // ön planda gösterme; sonra göstermek için: event.display()
});
HeroSignal.Notifications.addPermissionObserver(({ permission }) => {});
HeroSignal.User.pushSubscription.addObserver((state) => {});      // { id, token, optedIn, permission }
HeroSignal.InAppMessages.addClickListener((e) => {});             // { message: { id }, result: { actionId, url } }
HeroSignal.InAppMessages.addLifecycleListener({ willDisplay() {}, didDismiss() {} });
```

`addPermissionObserver` olayları yerel Android/iOS SDK izin gözlemcisinden gelir (izin isteği sonucu ve uygulama ön plana
döndüğünde ayarlardan yapılan değişiklik; yalnızca gerçek değişiklikte).

Her `add…` çağrısı aboneliği kaldıran bir fonksiyon döndürür. Olaylar native taraftan tek bir `keepCallback` kanalıyla gelir; kanal açılmadan oluşan olaylar (ör. soğuk başlatma tıklaması) native tarafta tamponlanır.

### In-app, bildirim kutusu ve diğerleri

```js
await HeroSignal.InAppMessages.addTrigger('level', 5);
await HeroSignal.InAppMessages.setScreen('checkout');
await HeroSignal.InAppMessages.setPaused(false);

const page = await HeroSignal.Inbox.list({ limit: 20 });      // { items, unreadCount, nextCursor, hasMore }
await HeroSignal.Inbox.markRead(page.items[0].id);
await HeroSignal.Inbox.markAllRead();
await HeroSignal.Inbox.archive(page.items[0].id);

// Tercihler (kategori × kanal opt-in; channel verilmezse tüm kanallar). Abonelik yoksa NOT_READY.
const { preferences, categories } = await HeroSignal.User.getPreferences();
await HeroSignal.User.setPreferences([
  { category: 'promo', optedIn: false },
  { category: 'news', channel: 'email', optedIn: true },
]);                                                           // güncel listeyi döndürür

await HeroSignal.Notifications.clearAll();
await HeroSignal.Notifications.removeGroupedNotifications('orders');
await HeroSignal.Notifications.removeNotification(id);        // Android: notification.androidNotificationId; iOS: UNNotificationRequest.identifier (metin)
await HeroSignal.setConsentGiven(true);                       // requiresPrivacyConsent: true ile başlatıldıysa
await HeroSignal.Debug.setLogLevel('debug');
await HeroSignal.logout();
```

## Android kurulumu (FCM)

1. Firebase konsolunda Android uygulaması ekleyin; `google-services.json` dosyasını proje köküne koyun ve `config.xml` içine ekleyin:

```xml
<platform name="android">
    <preference name="GradlePluginKotlinEnabled" value="true" />
    <preference name="GradlePluginGoogleServicesEnabled" value="true" />
    <preference name="GradlePluginGoogleServicesVersion" value="4.4.2" />
    <resource-file src="google-services.json" target="app/google-services.json" />
</platform>
```

   Köprü Kotlin ile yazıldığından `GradlePluginKotlinEnabled` zorunludur.
2. HeroSignal dashboard'unda Firebase servis hesabı JSON'unu yükleyin (kurulum sihirbazında **Cordova** seçilebilir); kayıt sonrası otomatik doğrulanır.
3. Eklenti `com.herosignal:herosignal-android` artefaktına bağlıdır. Maven Central yayınına kadar `sdk/android` içinde `gradle :herosignal:publishToMavenLocal` çalıştırın; eklenti `mavenLocal()` deposunu ekler.
4. FCM servisi, `POST_NOTIFICATIONS` izni ve bildirim Activity'si SDK manifestinden birleşir. Bildirim ikonu için `AndroidManifest.xml` içinde `com.herosignal.sdk.default_notification_icon` meta-data'sı verilebilir.

Eklenti, JS ile yapılan `initialize` ayarlarını (yalnızca uygulama kimliği ve herkese açık ayarlar) saklar; süreç bildirim tıklaması veya FCM mesajıyla yeniden başladığında SDK WebView yüklenmeden başlatılır.

## iOS kurulumu (APNs)

1. `config.xml`:

```xml
<platform name="ios">
    <preference name="deployment-target" value="15.0" />
    <preference name="SwiftVersion" value="5" />
</platform>
```

2. Eklenti Push Notifications yetkisini (`aps-environment`) ve `remote-notification` arka plan modunu ekler. HeroSignal dashboard'unda APNs `.p8` anahtarını veya `.p12` sertifikasını yükleyin.
3. `HeroSignal` pod'u yayınlanana kadar `platforms/ios/Podfile` içinde `pod 'HeroSignal', :path => '<repo>/sdk/ios'` kullanın ve `pod install` çalıştırın.
4. APNs token geri çağrıları (`didRegisterForRemoteNotificationsWithDeviceToken`/`didFailToRegister…`) eklenti yüklenirken AppDelegate sınıfına çalışma zamanında eklenir; AppDelegate'te bu metotlar varsa önce SDK'ya iletilir, sonra sizin kodunuz çalışır.
5. HeroSignal SDK'sı `UNUserNotificationCenter` delegesini üstlenir; başka bir push eklentisiyle (ör. `cordova-plugin-firebasex`) birlikte kullanmayın.

### Notification Service Extension (zengin medya, teslim bildirimi)

Resimli bildirimler, rozet artışı ve uygulama kapalıyken `received` bildirimi için Xcode'da (`platforms/ios/*.xcworkspace`) **File → New → Target → Notification Service Extension** ekleyin (iOS 15), Podfile'a hedefi ekleyin:

```ruby
target 'HeroSignalNSE' do
  pod 'HeroSignal/Extension', :path => '<repo>/sdk/ios'
end
```

ve `NotificationService.swift` dosyasını SDK yardımcısına devredin:

```swift
import UserNotifications
import HeroSignal

class NotificationService: UNNotificationServiceExtension {
    let hs = HeroSignalNotificationServiceExtension(appId: "app_xxx", apiUrl: "https://api.herosignal.dev",
                                                    appGroup: "group.com.example.app.herosignal")

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        hs.didReceive(request, withContentHandler: handler)
    }

    override func serviceExtensionTimeWillExpire() { hs.serviceExtensionTimeWillExpire() }
}
```

Uygulama ve NSE hedeflerinde aynı App Group yeteneğini açın ve uygulamanın `Info.plist` dosyasına `HeroSignalAppGroup` anahtarıyla yazın (rozet sayacı paylaşımı). `cordova platform rm/add ios` Xcode projesini yeniden oluşturduğundan NSE hedefi yeniden eklenmelidir.

## Geliştirme

```bash
npm install
npm run typecheck
npm test        # vitest: cephe, cordova.exec köprüsü ve native sözleşme denetimi
npm run build   # src/*.ts → www/*.js (eklentiyle birlikte yayınlanır, depoda tutulur)
```

Örnek uygulama: `examples/cordova`.
