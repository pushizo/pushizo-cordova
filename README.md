<!-- pushizo:header -->
<p align="center">
  <a href="https://pushizo.com"><img src="https://raw.githubusercontent.com/pushizo/.github/main/profile/assets/mark.svg" alt="Pushizo" width="56" height="56"></a>
</p>
<p align="center">
  <a href="https://docs.pushizo.com/docs/sdk/cordova"><img src="https://img.shields.io/badge/docs-docs.pushizo.com-5b4bdb" alt="Docs"></a>
  <a href="https://docs.pushizo.com/docs/api"><img src="https://img.shields.io/badge/API-reference-b44fc4" alt="API reference"></a>
  <a href="https://github.com/pushizo/pushizo-cordova/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-16130f" alt="License: MIT"></a>
</p>
<p align="center"><a href="#english">English</a> · <a href="#türkçe">Türkçe</a></p>

## English

**Pushizo Cordova plugin** — Cordova plugin that wraps the native Pushizo Android and iOS SDKs through cordova.exec.

```bash
cordova plugin add cordova-plugin-pushizo
```

The detailed guide below is in Turkish; code samples are language-neutral. Full documentation:
[docs.pushizo.com/docs/sdk/cordova](https://docs.pushizo.com/docs/sdk/cordova) · API reference: [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api).

## Türkçe
<!-- /pushizo:header -->

# cordova-plugin-pushizo

Pushizo'nun Cordova eklentisi. Native Pushizo Android (`com.pushizo:pushizo-android`) ve iOS (`Pushizo` pod) SDK'larını `cordova.exec` köprüsüyle sarar. API yüzeyi plan 06 §6.1, eski sağlayıcı v5 ve `@pushizo/capacitor` ile aynıdır.

- cordova ≥ 12, cordova-android ≥ 12 (minSdk 24), cordova-ios ≥ 7 (iOS 15+)
- Push aboneliği (FCM/APNs), izin istemi ve izin gözlemcisi
- Bildirim tıklaması (soğuk başlatma dahil), ön plan gösterimini engelleme/erteleme
- Kullanıcı: `login`/`logout` (`identityHash`), tag, alias, dil, e-posta ve SMS aboneliği
- In-app mesajlar (tetik, ekran, duraklatma, tıklama ve yaşam döngüsü olayları; native çizim)
- Konum paylaşımı (yalnızca ön plan, açıklama + izin istemi) ve arka plan bölge izleme
- Özellik bayrakları (`FeatureFlags`) ve gömülü yerleşimler (`Placements`)
- Android teslimat güçlendirme (`Delivery`: üretici/ROM teşhisi, ayar ekranına yönlendirme; iOS'ta zararsız)
- Profille `login`, reklam kişiselleştirme rızası (`setAdsPersonalizationConsent`, `getConsents`), reklam kimliği (`Ads`), rozet, arka plan konum izni
- Kullanıcı özellikleri (`User.setProperty`), özellik bayrağı ve bildirim kutusu gözlemcileri, olay tekilleştirme kimliği (`eventId`), hazır sohbet ekranı (`Chat.show`)
- Bildirim kutusu, özel olay, KVKK/GDPR gizlilik onayı, günlük seviyesi, bildirim tepsisini temizleme

## Kurulum

```bash
cordova plugin add cordova-plugin-pushizo
# monorepo içinden:
cordova plugin add ../../sdk/cordova
```

Eklenti JS'i `window.Pushizo` ve `window.plugins.Pushizo` olarak yüklenir. TypeScript için tipler pakettedir (`types/index.d.ts`).

## Kullanım

```js
document.addEventListener('deviceready', async () => {
  // Tıklama dinleyicisini erken ekleyin; uygulama bildirimden açıldıysa tıklama ilk dinleyiciye teslim edilir.
  Pushizo.Notifications.addClickListener((event) => {
    console.log(event.notification.title, event.result.actionId, event.result.url);
  });

  await Pushizo.initialize('app_xxx', { apiUrl: 'https://api.pushizo.com', logLevel: 'warn' });
  await Pushizo.Notifications.requestPermission();
  await Pushizo.login('user_42');                    // identity verification açıksa: login('user_42', identityHash)
  await Pushizo.User.addTags({ plan: 'pro', level: 3 });
  await Pushizo.User.addEmail('ali@pushizo.com');
  await Pushizo.Session.sendEvent('purchase', { sku: 'A1' }, 49.9);
});
```

Tüm metotlar Promise döndürür. Hatalar `PushizoError` örneğidir ve `code` alanı taşır: `INVALID_ARGUMENT`, `NOT_READY`, `NOT_FOUND`, `NOT_IMPLEMENTED` veya sunucu hata kodu.

### JWT ile kimlik doğrulama

App ayarlarında kimlik doğrulama kipi (`identity_verification_mode`) `jwt` veya `both` ise kullanıcı, sunucunuzda
imzalanmış kısa ömürlü bir ES256 JWT ile kimliklendirilir (talepler: `sub` = external_id, `aud` = app_id, `exp`/`iat` zorunlu, en çok 24 saat, yalnızca ES256).

```js
await Pushizo.login('user_42', { jwt: jwtFromBackend });                  // yalnızca JWT
await Pushizo.login('user_42', { identityHash: hmac, jwt: jwtFromBackend }); // both kipinde ikisi birlikte
await Pushizo.updateUserJwt(refreshedJwt); // süresi dolmadan yenileyin
await Pushizo.logout();
```

- JWT yerel SDK'da identity hash ile aynı kalıcı depoda saklanır ve tüm `/sdk/v1/...` isteklerinde
  `Authorization: Bearer <jwt>` başlığıyla gider; gövdeye/URL'ye yazılmaz, loglanmaz. `logout` belirteci siler.
- `/config` yanıtında `identity_verification_required` true ise login öncesi kanıt denetlenir: `jwt` kipinde JWT, `hmac`
  kipinde `identityHash` zorunludur, `both` kipinde biri yeter; eksikse `login` `NOT_READY` ile reddedilir. Alan gelmeyen
  eski sunucularda kip `hmac` sayılır; ikinci argümanı metin olan eski `login(id, identityHash)` çağrıları aynen çalışır.
- `updateUserJwt` giriş yapılmamışsa `NOT_READY` ile reddedilir; başarıda kuyrukta bekleyen işlemler yeni belirteçle
  yeniden denenir.

### Live Activities (iOS)

Köprü, iOS SDK'nın genel `PushizoDefaultLiveActivityAttributes` türünü kullanır "Live Activities"). Sunucu etkinliği uzaktan başlatır (push-to-start, iOS 17.2+), günceller ve bitirir;
yerel başlatma iOS 16.1+ ister.

```js
await Pushizo.initialize('app_xxx');
await Pushizo.LiveActivities.setupDefaultLiveActivity(); // her açılışta: belirteçler sunucuya kaydedilir
await Pushizo.LiveActivities.startDefaultLiveActivity(
  'order_42',                       // 1-100 karakter: harf, rakam, _ . : -
  { title: 'Sipariş #42' },         // attributes ('pushizo' anahtarı ayrılmıştır)
  { status: 'Yolda', eta: 12 },     // contentState
);
```

- Değerler metin, sonlu sayı veya boolean; anahtarlar 1-64 karakter. Kurala uymayan girdi köprüye gitmeden `TypeError`/
  `RangeError` fırlatır.
- Hata kodları (`PushizoError.code`): `PLATFORM_NOT_SUPPORTED` (iOS 16.1 öncesi; Android'de her zaman), `NOT_READY`
  (`initialize` yok), `INVALID_ARGUMENT`, `LIVE_ACTIVITY_FAILED` (Live Activities kapalı, `NSSupportsLiveActivities` yok,
  sistem sınırı).
- Xcode: uygulamanın Info.plist'ine `NSSupportsLiveActivities = YES` ekleyin; **Widget Extension** hedefi oluşturun ve
  hedefe SPM'de `PushizoExtension` ürününü (`import PushizoExtension`), CocoaPods'ta `pod 'Pushizo/Extension'`
  (`import Pushizo`) ekleyin:

```swift
ActivityConfiguration(for: PushizoDefaultLiveActivityAttributes.self) { context in
    VStack {
        Text(context.attributes.data["title"]?.stringValue ?? "")
        Text(context.state.data["status"]?.description ?? "")
    }
} dynamicIsland: { context in
    DynamicIsland { DynamicIslandExpandedRegion(.center) { Text(context.state.data["status"]?.description ?? "") } }
        compactLeading: { EmptyView() } compactTrailing: { Text(context.state.data["eta"]?.description ?? "") } minimal: { EmptyView() }
}
```

- Dashboard'da (**Live Activities**) veya API'de tür adı tam olarak `PushizoDefaultLiveActivityAttributes` olmalıdır.
  Sunucu: `POST /v1/apps/{appId}/live-activities/PushizoDefaultLiveActivityAttributes/start` (`activity_id`,
  `attributes`, `content_state`, `target`), `…/update` ve `…/end` (`activity_id`, `content_state`).
- Tip-güvenli kendi türünüz için native tarafta `Pushizo.LiveActivities.register(MyAttributes.self)` kullanın.

### Canlı sohbet

```ts
await Pushizo.Chat.start({ name: 'Ali' });
const config = await Pushizo.Chat.getConfig();          // online, offlineMessage, ek sınırları
const { messages } = await Pushizo.Chat.getMessages();
Pushizo.Chat.addEventListener('message', ({ message }) => render(message));
Pushizo.Chat.addEventListener('open', ({ conversationId }) => openChat(conversationId)); // bildirime tıklama
await Pushizo.Chat.startListening();                     // ekran açıkken; ayrılınca stopListening()
await Pushizo.Chat.sendMessage('Merhaba');               // bot hızlı yanıtı: sendMessage(label, { optionId })
await Pushizo.Chat.sendAttachment({ base64 }, { fileName: 'a.png', mimeType: 'image/png' });
await Pushizo.Chat.markRead(messages[messages.length - 1].seq);
```

Ziyaretçi kimliği, çevrimdışı kuyruk (aynı `client_message_id` ile yeniden deneme), canlı akış (SSE; koparsa üstel
geri çekilme + `after_seq` yoklaması) ve push ile gelen temsilci mesajları (`pushizo_chat`) yerel Android/iOS SDK'sındadır;
`start` sonrası login/logout ve push aboneliği değişince bağlama yerel SDK'da yenilenir, logout ziyaretçiyi sıfırlar.
Mesajlar `seq` ile sıralanır; ağ yokken gönderilen mesaj `pending` döner ve gönderilince olayla sunucu kopyası gelir.
Ayrıntı: [android rehberi](https://docs.pushizo.com/docs/sdk/android) / [ios rehberi](https://docs.pushizo.com/docs/sdk/ios) → "Canlı sohbet".

Hazır sohbet ekranı için kendi arayüzünüzü yazmanız gerekmez: `Pushizo.Chat.show()` yerel SDK'nın sohbet ekranını açar (Android `HsChatActivity`, iOS modal `HSChatViewController`), `Pushizo.Chat.hide()` kapatır, `Pushizo.Chat.isPresented()` ekranın açık olup olmadığını döndürür. Ayrıntı: "Kullanıcı özellikleri, gözlemciler, olay kimliği ve hazır sohbet ekranı".

### Konum

Kullanıcı izin verirse cihazın konumu push aboneliğine yazılır; segmentlerde konuma göre hedefleme için
kullanılır. Paylaşım **yalnızca ön planda** çalışır (arka plan konumu yok): native SDK konumu oturum başında ve uygulama
ön plana döndüğünde en sık 5 dakikada bir gönderir. İzin yoksa veya gizlilik onayı (`requiresPrivacyConsent`)
verilmemişse hiçbir şey gönderilmez; tercih kalıcıdır.

```js
const granted = await Pushizo.Location.requestPermission('Yakındaki mağazaları göstermek için konumunuzu kullanırız.');
if (granted) await Pushizo.Location.setShared(true);
const shared = await Pushizo.Location.isShared();         // kalıcı tercih (izin durumundan bağımsız)
await Pushizo.Location.setShared(false);                  // paylaşımı kapatır, sunucudaki konumu siler
```

- `requestPermission(rationale?)`: izin yoksa önce açıklama gösterilir (`rationale`; verilmezse SDK'nın Türkçe/İngilizce
  varsayılan metni), kullanıcı "Şimdi değil" derse sistem istemi açılmaz. İzin varsa veya verildiyse `true`; reddedildiyse,
  uygulama izni tanımlamadıysa ya da vazgeçildiyse `false`. `isShared()` native SDK'daki özelliğin asenkron karşılığıdır.
- `initialize` öncesinde `setShared`/`requestPermission` `NOT_READY` koduyla reddedilir.
- **KVKK:** sunucuya ulaşan ilk konum açık rıza kaydı olarak saklanır. Kullanıcıya konumun neden kullanıldığını
  açıklayın ve paylaşımı yalnızca onayıyla açın. `setShared(false)` sunucuya `location: null` gönderir; konum ve rıza
  kaydı silinir, henüz gönderilmemiş konum atılır.
- **iOS:** `Info.plist` dosyasına `NSLocationWhenInUseUsageDescription` ekleyin (yoksa `requestPermission` `false` döner);
  `config.xml` içinde `<platform name="ios">` altına
  `<edit-config file="*-Info.plist" target="NSLocationWhenInUseUsageDescription" mode="merge"><string>…</string></edit-config>`. Yalnızca "Uygulamayı Kullanırken" izni istenir; "Her Zaman" istenmez. Reddedilmiş izin yeniden
  sorulamaz, kullanıcı Ayarlar'a yönlendirilmelidir.
- **Android:** eklenti konum iznini manifest'e **otomatik eklemez**; uygulamanın `config.xml` dosyasına kendiniz ekleyin
  (yaklaşık konum yeterlidir, hassas konum isteğe bağlıdır; `<widget>` öğesinde
  `xmlns:android="http://schemas.android.com/apk/res/android"` tanımlı olmalıdır):

  ```xml
  <platform name="android">
    <config-file target="AndroidManifest.xml" parent="/manifest">
      <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
      <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    </config-file>
  </platform>
  ```

  Yalnızca manifest'te tanımlı izinler istenir; hiçbiri yoksa uyarı loglanır ve `false` döner. Açıklama diyaloğu SDK'nın
  string kaynaklarını kullanır; sistem izni `cordova.requestPermissions` ile (`Pushizo.Location.PERMISSION_REQUEST_CODE`)
  istenir ve sonuç SDK'ya iletilir.

### Arka plan bölge izleme

Dashboard'da tanımlı coğrafi bölgelere giriş/çıkışı uygulama kapalıyken de yakalar ([ADR-0065](https://github.com/pushizo/pushizo/blob/main/docs/adr/0065-arka-plan-bolge-izleme.md)).
İzlemeyi işletim sistemi yapar; sunucuya koordinat gitmez, yalnızca giriş/çıkış olayı bildirilir. Varsayılan **kapalıdır**.

```js
await Pushizo.Location.setGeofencingEnabled(true);        // kalıcı tercih
const on = await Pushizo.Location.isGeofencingEnabled();
```

- Üç koşul birlikte gerekir: `setGeofencingEnabled(true)`, `setShared(true)` ve arka plan konum izni (iOS "Her Zaman",
  Android `ACCESS_BACKGROUND_LOCATION`). Köprü bu izni manifest/Info.plist'e **eklemez**; `Info.plist`'e `NSLocationAlwaysAndWhenInUseUsageDescription`, Android manifest'ine `ACCESS_BACKGROUND_LOCATION` eklemek
  (`config.xml` `<config-file>`/`<edit-config>`) uygulamanın işidir. İzin `Location.requestBackgroundPermission()` ile istenir (aşağıda).
  Mağaza beyanları ve aydınlatma metni uygulama geliştiricisinin sorumluluğundadır.
- `initialize` öncesinde `setGeofencingEnabled` `NOT_READY` ile reddedilir. `setShared(false)` veya gizlilik onayının geri
  alınması kayıtlı bölgeleri kaldırır; tercih korunur.
- **Android:** uygulamada `com.google.android.gms:play-services-location` bağımlılığı bulunmalıdır; yoksa yerel SDK uyarı
  loglar ve izleme başlamaz.

### Özellik bayrakları

Bir özelliği yeni sürüm yayımlamadan açıp kapatın, kademeli yayın yapın veya metin/sayı/JSON değerleri uzaktan yönetin
([rehber](https://docs.pushizo.com/docs/guides/feature-flags)). Değerler yerel SDK'da oturum başında yenilenir ve cihazda
saklanır; ağ yoksa son değer, hiç alınmadıysa koddaki varsayılan döner. Gizlilik onayı beklenirken istek gönderilmez.

```js
if (await Pushizo.FeatureFlags.isEnabled('yeni_sepet')) showNewCart();
const limit = await Pushizo.FeatureFlags.getValue('sepet_limiti', 10);   // metin, sayı, boolean, nesne veya dizi
const refreshed = await Pushizo.FeatureFlags.refresh();                  // yeni değerler alındıysa true
```

`isEnabled(key, default = false)` ve `getValue(key, default = null)` yerel önbellekten okur; köprü asenkron olduğundan
Promise döndürürler. Boş anahtar `TypeError` ile reddedilir.

### Android teslimat güçlendirme

Xiaomi, Huawei, Oppo, Vivo ve Samsung gibi üreticilerde pil ve otomatik başlatma yöneticisi arka plandaki uygulamayı durdurur;
bildirim gecikir ya da gelmez ([rehber](https://docs.pushizo.com/docs/channels/android-delivery)). `Pushizo.Delivery` cihazdaki
kısıtları okur ve kullanıcıyı ilgili ayar ekranına götürür.

```ts
const status = await Pushizo.Delivery.status(); // { supported, vendor, rom, risk, restricted, recommendedSettings, … }
if (await Pushizo.Delivery.shouldShowGuidance()) {      // risk var ve diyalog son 14 günde gösterilmedi
  const opened = await Pushizo.Delivery.showGuidance(); // hazır diyalog (22 dil); kabul edilirse ayar ekranı açılır
}
await Pushizo.Delivery.openSettings('auto_start');      // kendi arayüzünüzden
```

| Metot | Açıklama |
|---|---|
| `Delivery.status()` | `Promise<DeliveryStatus>`: `supported`, `manufacturer`, `brand`, `vendor`, `aggressiveVendor`, `rom`, `romVersion`, `notificationsEnabled`, `channelBlocked`, `batteryOptimizationExempt`, `backgroundRestricted`, `standbyBucket`, `powerSaveMode`, `dataSaverEnabled`, `restricted`, `risk` (`none` \| `elevated` \| `high`), `recommendedSettings`. |
| `Delivery.shouldShowGuidance(minIntervalDays = 14)` | `Promise<boolean>`: teslim riski var ve hazır diyalog son `minIntervalDays` günde gösterilmedi. |
| `Delivery.openSettings(setting = 'auto')` | `Promise<boolean>`: ayar ekranı açıldı mı. `setting`: `auto` \| `notifications` \| `auto_start` \| `battery_optimization` \| `app_details`; üreticiye özgü ekran yoksa standart Android ekranına düşülür. |
| `Delivery.showGuidance({ setting?, message? })` | `Promise<boolean>`: hazır açıklama diyaloğu; kullanıcı kabul etti ve ayar ekranı açıldıysa `true`. SDK diyaloğu kendiliğinden göstermez. |

Yalnızca Android'de etkilidir: iOS'ta `status()` `supported: false` ve `risk: 'none'` döner, `openSettings` ile `showGuidance`
hiçbir şey yapmadan `false` döner. Köprü `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` iznini istemez ve manifest'e eklemez.

### Profil, reklam rızası, reklam kimliği ve rozet

Yerel SDK'ların kalan yüzeyi de köprüde vardır; tek platforma özgü çağrılar diğer platformda zararsızdır (istisna yok,
etkisiz ya da `false`).

```js
await Pushizo.login('user_42', { jwt, profile: { email: 'ali@ornek.com', sms: '+905551112233', tags: { plan: 'pro' }, aliases: { crm: 'c-1' } } });
await Pushizo.User.setAdsPersonalizationConsent(true);     // reklam kişiselleştirme rızası; güncel tercihleri döndürür
const consents = await Pushizo.User.getConsents();         // [{ purpose, granted, source, updatedAt }]
await Pushizo.Ads.setAdvertisingId(gaidOrIdfa);            // null kaydı siler
const shown = await Pushizo.Notifications.setBadgeCount(3); // rozet bu cihazda gösterilebiliyorsa true
await Pushizo.Notifications.clearBadge();
if (await Pushizo.Location.permissionGranted() && !(await Pushizo.Location.backgroundPermissionGranted())) {
  await Pushizo.Location.requestBackgroundPermission('Mağazaya yaklaşınca haber vermek için'); // iOS: requestAlwaysPermission ile aynı
}
const listening = await Pushizo.Chat.isListening();
const ready = await Pushizo.isInitialized();
```

| Metot | Açıklama |
|---|---|
| `login(externalId, { identityHash?, jwt?, profile? })` | `profile`: `{ email?, sms?, tags?, aliases? }`. Giriş ve profil tek çağrıda; geçersiz e-posta/telefon/takma ad girişten **önce** `INVALID_ARGUMENT` ile reddedilir. Doğrulama ve sıralama yerel SDK'lardadır (Android `login(id, HsUserProfile)`, iOS `login(_:profile:)`). |
| `User.setAdsPersonalizationConsent(granted)` | `Promise<UserPreferences>`: reklam kişiselleştirme rızası (`ads_personalization`); `false` rızayı geri alır. |
| `User.getConsents()` | `Promise<UserConsent[]>`: `purpose`, `granted`, `source`, `updatedAt` (epoch ms). Abonelik yoksa `NOT_READY`. |
| `User.registerAdm(token)` | Fire OS ADM kayıt kimliği (yalnızca Android; geçersiz kimlik `INVALID_ARGUMENT`). iOS: etkisiz. |
| `Ads.setAdvertisingId(id \| null)` | GAID/IDFA; `null` veya sıfır kimlik sunucudaki kaydı siler. Kimliği uygulama alır (SDK reklam kitaplığı ve ATT istemi içermez). |
| `Notifications.setBadgeCount(count)` / `clearBadge()` | `Promise<boolean>`: rozet bu cihazda gösterilebiliyorsa `true`. `count` negatif olmayan tam sayı (`RangeError`). iOS: uygulama rozeti ve bildirim uzantısıyla paylaşılan sayaç (her zaman `true`). Android: başlatıcı rozeti için "sayıyı ayarla" API'si olmadığından yerel SDK sayıyı saklar ve sonraki bildirimlere yazar; Android 8 öncesinde, bildirimler ya da kanal rozeti kapalıyken `false`. |
| `Notifications.getBadgeCount()` | `Promise<number>`: Android'de saklanan son sayı, iOS'ta uygulama simgesindeki rozet. |
| `Location.permissionGranted()` / `backgroundPermissionGranted()` | `Promise<boolean>`: ön plan / arka plan ("Her Zaman") konum izni; yerel SDK'dan okunur, istem açmaz. |
| `Location.requestBackgroundPermission(rationale?)` / `requestAlwaysPermission()` | `Promise<boolean>`: arka plan konum izni; iki ad aynı çağrıdır. Android: açıklama diyaloğu + `ACCESS_BACKGROUND_LOCATION` (Android 11+ Ayarlar ekranı; manifest'te yoksa `false`). iOS: "Her Zaman" izni (`rationale` kullanılmaz). |
| `Chat.isListening()` | `Promise<boolean>`: canlı dinleme açık mı. |
| `isInitialized()` | `Promise<boolean>`: yerel SDK başlatıldı mı. |

### Kullanıcı özellikleri, gözlemciler, olay kimliği ve hazır sohbet ekranı

```js
await Pushizo.User.setProperty('plan', 'pro');                                  // metin, sayı, mantıksal
await Pushizo.User.setProperty('address', { city: 'İzmir', tags: ['vip'] });   // dizi / düz nesne
await Pushizo.User.setProperty('plan', null);                                   // null özelliği siler

const removeFlags = Pushizo.FeatureFlags.addObserver(async () => {
  applyTheme(await Pushizo.FeatureFlags.getValue('tema', 'acik'));
});
const removeInbox = Pushizo.Inbox.addObserver(({ type, itemId, unreadCount }) => setBadge(unreadCount));

// Reklam pikseliyle aynı kimlik verilirse sunucu olayı tekilleşir.
await Pushizo.Session.sendEvent('purchase', { sku: 'A1' }, 49.9, { eventId: 'order_42:purchase' });

await Pushizo.Chat.show();                        // hazır sohbet ekranı
if (await Pushizo.Chat.isPresented()) await Pushizo.Chat.hide();
```

| Metot | Açıklama |
|---|---|
| `User.setProperty(key, value)` | Kullanıcı özelliği yazar; `null` siler. `key` 1-64 karakter (`TypeError` / `RangeError`); `value` metin, sonlu sayı, mantıksal ya da bunların dizisi/düz nesnesi (iç içe `null`, `Date`, fonksiyon vb. `TypeError`). Çevrimdışıyken yerel SDK kuyruğunda bekler. |
| `FeatureFlags.addObserver(cb)` / `removeObserver(cb)` | Bayrak değerleri sunucudan her yenilendiğinde (oturum başı ve `refresh()`) çağrılır; `addObserver` aboneliği kaldıran fonksiyonu döndürür. |
| `Inbox.addObserver(cb)` / `removeObserver(cb)` | Kutu değişim olayı: `{ type: 'listed' \| 'read' \| 'read_all' \| 'archived' \| 'count', itemId?, unreadCount }`. `read`/`read_all`/`archived` her işlemde, `listed`/`count` yalnızca okunmamış sayısı değiştiğinde bildirilir; `itemId` yalnızca tek öğe olaylarında bulunur. |
| `Session.sendEvent(name, properties?, value?, { eventId? })` | `eventId` tekilleştirme kimliğidir: 8-64 karakter; harf, rakam ve `. _ : -`. Biçim geçersizse yerel SDK kendi kimliğini üretir; metin olmayan kimlik `TypeError`. |
| `Chat.show()` / `hide()` | Hazır sohbet ekranını açar / kapatır (Android `HsChatActivity`, iOS modal `HSChatViewController`). Ekran açıksa yenisi açılmaz; `initialize` öncesinde `show()` `NOT_READY` ile reddedilir. |
| `Chat.isPresented()` | `Promise<boolean>`: hazır sohbet ekranı açık mı. Yerel Android SDK bu durumu dışa açmadığından köprü `HsChatActivity` yaşam döngüsünü izler. |

Köprüye bağlanamayan yerel yüzey: yerel görünümler (`HsChatView`, `HsContentCardsView`, iOS `HSChatViewController` gömme) ve
`InAppMessages.setRenderer` (özel çizici yerel kod ister).

### Gömülü yerleşimler

Uygulamanın ayırdığı bir alana (ana sayfa afişi, liste arası kart) dashboard'dan içerik gönderin
([ADR-0068](https://github.com/pushizo/pushizo/blob/main/docs/adr/0068-gomulu-yerlesimler.md)). Köprü yalnızca modeli
döndürür; çizim uygulamanındır.

```js
const messages = await Pushizo.Placements.list('home_banner', { limit: 2 });   // InAppMessage[]
for (const message of messages) {
  render(message.display.blocks);                                            // title/body/image/button/carousel blokları veya display.html
  await Pushizo.Placements.reportImpression(message);                        // içerik ekrana gelince
}
await Pushizo.Placements.reportClick(message, buttonId);                     // düğme tıklanınca (buttonId: blok/kart düğmesinin id'si)
await Pushizo.Placements.reportDismiss(message);                             // kullanıcı kapatınca
```

- Anahtar `^[a-z][a-z0-9_.-]{0,63}$` kalıbına uymalı, `limit` 1-10 olmalıdır; aksi halde çağrı köprüye gitmeden
  `TypeError`/`RangeError` ile reddedilir. Abonelik yoksa veya gizlilik onayı bekleniyorsa liste boştur.
- `InAppMessage` alanları yerel modelle aynıdır (`id`, `priority`, `triggers`, `triggerGroups`, `variantId`, `display`,
  `remainingImpressions`, `minIntervalSeconds`, `stopAfterInteraction`, `lastImpressionAt`, `endAt`, `language`); zamanlar
  epoch milisaniyedir. Düğme aksiyonları (`url`, `deeplink`, `tags`, `push_prompt`, `outcome`, `dismiss`) uygulama
  tarafından yürütülür.
- Rapor çağrıları yerel tarafta son `list` yanıtlarındaki mesajı kimliğiyle bulur (en çok 50 mesaj saklanır); listeden
  gelmeyen bir mesaj için rapor sessizce yok sayılır (debug log).
- Ağ/sunucu hatasında Android boş liste döndürür; iOS çağrıyı hata koduyla reddeder.

### Olaylar

```js
Pushizo.Notifications.addForegroundLifecycleListener((event) => {
  event.preventDefault();        // ön planda gösterme; sonra göstermek için: event.display()
});
Pushizo.Notifications.addPermissionObserver(({ permission }) => {});
Pushizo.User.pushSubscription.addObserver((state) => {});      // { id, token, optedIn, permission }
Pushizo.InAppMessages.addClickListener((e) => {});             // { message: { id }, result: { actionId, url } }
Pushizo.InAppMessages.addLifecycleListener({ willDisplay() {}, didDismiss() {} });
```

`addPermissionObserver` olayları yerel Android/iOS SDK izin gözlemcisinden gelir (izin isteği sonucu ve uygulama ön plana
döndüğünde ayarlardan yapılan değişiklik; yalnızca gerçek değişiklikte).

Her `add…` çağrısı aboneliği kaldıran bir fonksiyon döndürür. Olaylar native taraftan tek bir `keepCallback` kanalıyla gelir; kanal açılmadan oluşan olaylar (ör. soğuk başlatma tıklaması) native tarafta tamponlanır.

### In-app, bildirim kutusu ve diğerleri

```js
await Pushizo.InAppMessages.addTrigger('level', 5);
await Pushizo.InAppMessages.setScreen('checkout');
await Pushizo.InAppMessages.setPaused(false);

const page = await Pushizo.Inbox.list({ limit: 20 });      // { items, unreadCount, nextCursor, hasMore }
await Pushizo.Inbox.markRead(page.items[0].id);
await Pushizo.Inbox.markAllRead();
await Pushizo.Inbox.archive(page.items[0].id);

// Tercihler (kategori × kanal opt-in; channel verilmezse tüm kanallar). Abonelik yoksa NOT_READY.
const { preferences, categories } = await Pushizo.User.getPreferences();
await Pushizo.User.setPreferences([
  { category: 'promo', optedIn: false },
  { category: 'news', channel: 'email', optedIn: true },
]);                                                           // güncel listeyi döndürür

await Pushizo.Notifications.clearAll();
await Pushizo.Notifications.removeGroupedNotifications('orders');
await Pushizo.Notifications.removeNotification(id);        // Android: notification.androidNotificationId; iOS: UNNotificationRequest.identifier (metin)
await Pushizo.setConsentGiven(true);                       // requiresPrivacyConsent: true ile başlatıldıysa
await Pushizo.Debug.setLogLevel('debug');
await Pushizo.logout();
```

### HTML in-app ve carousel

In-app mesajları yerel Android/iOS SDK'sı çizer; bu paket köprüdür. HTML in-app (sandbox'lı WebView, köprü
`close`/`click`/`addTag`/`trackEvent`) ve carousel blokları yerel SDK'dan olduğu gibi devralınır: ek kod veya
yapılandırma gerekmez, tıklama ve yaşam döngüsü olayları mevcut in-app dinleyicilerine gelir. Yetenek bildirimi
(`supports=html,carousel`) yerel SDK tarafından yapılır; desteklemeyen eski yerel sürümlere sunucu HTML mesaj göndermez
ve carousel bloklarını çıkarır.

## Android kurulumu (FCM)

1. Firebase konsolunda Android uygulaması ekleyin; `google-services.json` dosyasını proje köküne koyun ve `config.xml` içine ekleyin:

```xml
<platform name="android">
    <preference name="GradlePluginKotlinEnabled" value="true" />
    <preference name="GradlePluginGoogleServicesEnabled" value="true" />
    <preference name="GradlePluginGoogleServicesVersion" value="4.4.2" />
    <preference name="android-compileSdkVersion" value="35" />
    <resource-file src="google-services.json" target="app/google-services.json" />
</platform>
```

   Köprü Kotlin ile yazıldığından `GradlePluginKotlinEnabled` zorunludur. Yerel SDK 0.3.0'in `androidx.work` bağımlılığı
   `compileSdk` 35 ister; cordova-android 13'ün varsayılanı 34 olduğundan `android-compileSdkVersion` tercihi gerekir.
2. Pushizo dashboard'unda Firebase servis hesabı JSON'unu yükleyin (kurulum sihirbazında **Cordova** seçilebilir); kayıt sonrası otomatik doğrulanır.
3. Eklenti `com.pushizo:pushizo-android:0.3.0` artefaktına bağlıdır (özellik bayrakları, yerleşimler ve bölge izleme bu sürümle gelir). Maven Central yayınına kadar `sdk/android` içinde `gradle :pushizo:publishToMavenLocal` çalıştırın; eklenti `mavenLocal()` deposunu ekler.
4. FCM servisi, `POST_NOTIFICATIONS` izni ve bildirim Activity'si SDK manifestinden birleşir. Bildirim ikonu için `AndroidManifest.xml` içinde `com.pushizo.sdk.default_notification_icon` meta-data'sı verilebilir.

Eklenti, JS ile yapılan `initialize` ayarlarını (yalnızca uygulama kimliği ve herkese açık ayarlar) saklar; süreç bildirim tıklaması veya FCM mesajıyla yeniden başladığında SDK WebView yüklenmeden başlatılır.

## iOS kurulumu (APNs)

1. `config.xml`:

```xml
<platform name="ios">
    <preference name="deployment-target" value="15.0" />
    <preference name="SwiftVersion" value="5" />
</platform>
```

2. Eklenti Push Notifications yetkisini (`aps-environment`) ve `remote-notification` arka plan modunu ekler. Pushizo dashboard'unda APNs `.p8` anahtarını veya `.p12` sertifikasını yükleyin.
3. `Pushizo` pod'u yayınlanana kadar `platforms/ios/Podfile` içinde `pod 'Pushizo', :path => '<repo>/sdk/ios'` kullanın ve `pod install` çalıştırın.
4. APNs token geri çağrıları (`didRegisterForRemoteNotificationsWithDeviceToken`/`didFailToRegister…`) eklenti yüklenirken AppDelegate sınıfına çalışma zamanında eklenir; AppDelegate'te bu metotlar varsa önce SDK'ya iletilir, sonra sizin kodunuz çalışır.
5. Pushizo SDK'sı `UNUserNotificationCenter` delegesini üstlenir; başka bir push eklentisiyle (ör. `cordova-plugin-firebasex`) birlikte kullanmayın.

### Notification Service Extension (zengin medya, teslim bildirimi)

Resimli bildirimler, rozet artışı ve uygulama kapalıyken `received` bildirimi için Xcode'da (`platforms/ios/*.xcworkspace`) **File → New → Target → Notification Service Extension** ekleyin (iOS 15), Podfile'a hedefi ekleyin:

```ruby
target 'PushizoNSE' do
  pod 'Pushizo/Extension', :path => '<repo>/sdk/ios'
end
```

ve `NotificationService.swift` dosyasını SDK yardımcısına devredin:

```swift
import UserNotifications
import Pushizo

class NotificationService: UNNotificationServiceExtension {
    let hs = PushizoNotificationServiceExtension(appId: "app_xxx", apiUrl: "https://api.pushizo.com",
                                                    appGroup: "group.com.pushizo.app.pushizo")

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        hs.didReceive(request, withContentHandler: handler)
    }

    override func serviceExtensionTimeWillExpire() { hs.serviceExtensionTimeWillExpire() }
}
```

Uygulama ve NSE hedeflerinde aynı App Group yeteneğini açın ve uygulamanın `Info.plist` dosyasına `PushizoAppGroup` anahtarıyla yazın (rozet sayacı paylaşımı). `cordova platform rm/add ios` Xcode projesini yeniden oluşturduğundan NSE hedefi yeniden eklenmelidir.

## Geliştirme

```bash
npm install
npm run typecheck
npm test        # vitest: cephe, cordova.exec köprüsü ve native sözleşme denetimi
npm run build   # src/*.ts → www/*.js (eklentiyle birlikte yayınlanır, depoda tutulur)
```

Adım adım kurulum ve örnek kod: [cordova rehberi](https://docs.pushizo.com/docs/sdk/cordova).

<!-- pushizo:footer -->
---

## Support · Destek

- **Guide · Rehber:** [docs.pushizo.com/docs/sdk/cordova](https://docs.pushizo.com/docs/sdk/cordova)
- **API reference & OpenAPI · API referansı ve OpenAPI:** [docs.pushizo.com/docs/api](https://docs.pushizo.com/docs/api) ·
  [pushizo-openapi](https://github.com/pushizo/pushizo-openapi)
- **Bugs & ideas · Hata ve öneri:** [Issues](https://github.com/pushizo/pushizo-cordova/issues)
- **Security · Güvenlik:** please do not open public issues; email [security@pushizo.com](mailto:security@pushizo.com) ·
  herkese açık issue açmayın, bu adrese yazın.
- **Help · Destek:** [support@pushizo.com](mailto:support@pushizo.com)

This repository is mirrored automatically from the Pushizo main repository on every release. Please open an issue
instead of a pull request; fixes land in the main repository and ship with the next release.
Bu depo her sürümde Pushizo ana deposundan otomatik yansıtılır. Pull request yerine issue açın; düzeltmeler ana depoda
yapılır ve bir sonraki sürümle buraya gelir.

Released under the MIT License · MIT lisanslıdır — [LICENSE](https://github.com/pushizo/pushizo-cordova/blob/main/LICENSE).
<!-- /pushizo:footer -->
