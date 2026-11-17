import type { ChatAttachmentOptions, ChatAttachmentSource, ChatConfig, ChatConversationState, ChatEventMap, ChatIdentifyResult, ChatMessage, ChatMessagePage, ChatMessagesOptions, ChatStartOptions, FeatureFlagValue, ForegroundWillDisplayEvent, PushizoNotification, InAppClickEvent, InAppLifecycleListener, InAppMessage, InAppTriggerValue, ContentCard, ContentCardFeed, DeliveryGuidanceOptions, DeliverySetting, DeliveryStatus, InboxItem, InboxListOptions, InboxPage, InitializeOptions, LiveActivityValue, LogLevel, LoginOptions, NotificationClickEvent, PermissionChangeEvent, PlacementListOptions, PreferenceInput, PushSubscriptionState, UserConsent, UserPreferences } from './definitions';
/** Native katmandan gelen olay adları. */
export type BridgeEventType = 'click' | 'foregroundWillDisplay' | 'pushSubscriptionChange' | 'permissionChange' | 'inAppClick' | 'inAppLifecycle' | 'chatEvent' | 'chatOpen';
/** Taşıma katmanı: native metot çağrısı ve olay aboneliği. */
export interface Bridge {
    call<T = void>(method: string, args?: Record<string, unknown>): Promise<T>;
    /** Tüm native olaylarını tek işleyiciye bağlar; cephe yalnızca bir kez çağırır. */
    subscribe(handler: (type: BridgeEventType, payload: unknown) => void): void | Promise<void>;
}
type Listener<T> = (event: T) => void;
/** Native bildirim nesnesini eksik alanlara karşı normalize eder. */
export declare function normalizeNotification(raw: Partial<PushizoNotification> | undefined): PushizoNotification;
/** Uygulamaların kullandığı Pushizo cephesi. */
export declare class PushizoCore {
    private readonly bridge;
    private subscribed;
    private subscribing;
    private readonly clickListeners;
    private readonly foregroundListeners;
    private readonly subscriptionObservers;
    private readonly permissionObservers;
    private readonly inAppClickListeners;
    private readonly inAppLifecycleListeners;
    /** Dinleyici yokken gelen tıklamalar (soğuk başlatma); ilk dinleyiciye teslim edilir. */
    private readonly pendingClicks;
    /** Canlı sohbet dinleyicileri (tür başına). */
    private readonly chatListeners;
    /** Dinleyici yokken gelen sohbet bildirimi tıklamaları (soğuk başlatma). */
    private readonly pendingChatOpens;
    private foregroundFlag;
    constructor(bridge: Bridge);
    /** Native olaylarına bir kez abone olur (initialize veya ilk dinleyicide). */
    private ensureSubscribed;
    /** Native olayını ilgili dinleyicilere dağıtır (test ve taşıma katmanı için açık). */
    dispatch(type: BridgeEventType, payload: unknown): void;
    private onClick;
    /**
     * Ön plan kararı: dinleyiciler senkron çalışır; hiçbiri `preventDefault()` çağırmadıysa ve native
     * gösterimi bekletiyorsa (`pending`) bildirim hemen gösterilir.
     */
    private onForeground;
    private syncForegroundFlag;
    private listen;
    /** SDK'yı başlatır; olay aboneliği burada kurulur. */
    initialize(appIdOrOptions: string | InitializeOptions, options?: Omit<InitializeOptions, 'appId'>): Promise<void>;
    /** Native SDK başlatıldı mı (`initialize` tamamlandı ya da süreç saklanan yapılandırmayla erkenden başlatıldı). */
    isInitialized: () => Promise<boolean>;
    /** KVKK/GDPR onayı (`requiresPrivacyConsent: true` ile başlatıldıysa). */
    setConsentGiven(given: boolean): Promise<void>;
    /**
     * Anonim kullanıcıyı kimlikli kullanıcıya bağlar. Identity verification açıksa app moduna göre `identityHash`
     * (eski imza: ikinci argüman metin) ve/veya JWT gerekir: `login(id, { jwt })`. `profile` verilirse e-posta, SMS,
     * etiket ve takma adlar aynı çağrıda ayarlanır: `login(id, { profile: { email: 'ali@ornek.com' } })`; geçersiz
     * e-posta veya telefon girişten önce `INVALID_ARGUMENT` ile reddedilir (yarım kalmış kimlik değişimi olmaz).
     */
    login(externalId: string, proof?: string | LoginOptions): Promise<void>;
    /** Süresi dolan kimlik JWT'sini yeniler (giriş yapmış kullanıcı için); sonraki SDK istekleri yeni belirteci taşır. */
    updateUserJwt(jwt: string): Promise<void>;
    /** Kullanıcıyı anonim kullanıcıya döndürür; kimlik JWT'si cihazdan silinir. */
    logout(): Promise<void>;
    readonly User: {
        addTag: (key: string, value: InAppTriggerValue) => Promise<void>;
        addTags: (tags: Record<string, InAppTriggerValue>) => Promise<void>;
        removeTag: (key: string) => Promise<void>;
        removeTags: (keys: string[]) => Promise<void>;
        getTags: () => Promise<Record<string, string>>;
        setLanguage: (code: string) => Promise<void>;
        addAlias: (label: string, id: string) => Promise<void>;
        addAliases: (aliases: Record<string, string>) => Promise<void>;
        removeAlias: (label: string) => Promise<void>;
        addEmail: (email: string) => Promise<void>;
        removeEmail: (email: string) => Promise<void>;
        addSms: (phoneNumber: string) => Promise<void>;
        removeSms: (phoneNumber: string) => Promise<void>;
        getExternalId: () => Promise<string | null>;
        getId: () => Promise<string | null>;
        /** Bu cihazda `addEmail` ile kaydedilmiş e-posta adresleri (yerel kayıt; sunucu sorgulanmaz). */
        getEmails: () => Promise<string[]>;
        /** Bu cihazda `addSms` ile kaydedilmiş SMS numaraları (E.164; yerel kayıt). */
        getSmsNumbers: () => Promise<string[]>;
        /**
         * Kullanıcının kategori/kanal tercihleri ve app kategorileri (ADR-0019 §4); sahiplik kanıtı yerel SDK'da eklenir.
         * Abonelik henüz yoksa `NOT_READY` koduyla reddedilir.
         */
        getPreferences: () => Promise<UserPreferences>;
        /** Tercihleri yazar (1-100 kayıt; `channel` verilmezse tüm kanallar); güncel listeyi döndürür. */
        setPreferences: (preferences: PreferenceInput[]) => Promise<UserPreferences>;
        /**
         * Reklam kişiselleştirme rızası (ADR-0037): `true` iken kullanıcının e-posta/telefon özeti app'in bağladığı reklam
         * platformu kitlelerine gönderilebilir; `false` rızayı geri alır. Güncel tercih listesini döndürür.
         */
        setAdsPersonalizationConsent: (granted: boolean) => Promise<UserPreferences>;
        /** Rıza kayıtları (`ads_personalization` …). Abonelik henüz yoksa `NOT_READY` koduyla reddedilir. */
        getConsents: () => Promise<UserConsent[]>;
        /**
         * Fire OS ADM kayıt kimliği (yalnızca Android; ana FCM aboneliğinin yerine geçmez). ADM kaydını kendisi yapan
         * uygulamalar içindir. iOS ve web'de etkisizdir.
         */
        registerAdm: (token: string) => Promise<void>;
        pushSubscription: {
            getState: () => Promise<PushSubscriptionState>;
            getId: () => Promise<string | null>;
            getToken: () => Promise<string | null>;
            getOptedIn: () => Promise<boolean>;
            optIn: () => Promise<void>;
            optOut: () => Promise<void>;
            /** Token/abonelik/izin değişimi; dönen fonksiyon aboneliği kaldırır. */
            addObserver: (cb: Listener<PushSubscriptionState>) => (() => void);
            removeObserver: (cb: Listener<PushSubscriptionState>) => void;
        };
    };
    readonly Notifications: {
        /** Sistem bildirim izni (Android 13+ POST_NOTIFICATIONS, iOS UNAuthorization). */
        getPermission: () => Promise<boolean>;
        /** İzin ister; sonuç izin durumudur. */
        requestPermission: () => Promise<boolean>;
        /** Tepsideki/bildirim merkezindeki tüm Pushizo bildirimlerini kaldırır ve rozeti sıfırlar. */
        clearAll: () => Promise<void>;
        /**
         * Tek bildirimi kaldırır. Android: `notification.androidNotificationId` (tamsayı). iOS: bildirim isteği kimliği
         * (`UNNotificationRequest.identifier`, metin; tamsayı verilirse metne çevrilir). Web'de `UNAVAILABLE`.
         */
        removeNotification: (id: number | string) => Promise<void>;
        /** Aynı gruptaki bildirimleri kaldırır (Android `android_group`, iOS `thread-id`). */
        removeGroupedNotifications: (group: string) => Promise<void>;
        /**
         * Uygulama rozetini ayarlar (yalnızca iOS; bildirim uzantısıyla paylaşılan sayaç da eşitlenir). Android'de rozet
         * görünen bildirimlerden hesaplandığından ve web'de karşılığı olmadığından etkisizdir.
         */
        setBadgeCount: (count: number) => Promise<void>;
        /** Rozeti sıfırlar (yalnızca iOS; Android ve web'de etkisiz). */
        clearBadge: () => Promise<void>;
        /** Bildirim/düğme tıklaması; soğuk başlatmada bekleyen tıklama ilk dinleyiciye teslim edilir. */
        addClickListener: (cb: Listener<NotificationClickEvent>) => (() => void);
        removeClickListener: (cb: Listener<NotificationClickEvent>) => void;
        /** Ön planda gelen bildirim; `event.preventDefault()` gösterimi engeller, `event.display()` gösterir. */
        addForegroundLifecycleListener: (cb: Listener<ForegroundWillDisplayEvent>) => (() => void);
        removeForegroundLifecycleListener: (cb: Listener<ForegroundWillDisplayEvent>) => void;
        /** İzin değişimi (istem sonucu veya kullanıcının sistem ayarlarından değiştirmesi). */
        addPermissionObserver: (cb: Listener<PermissionChangeEvent>) => (() => void);
        removePermissionObserver: (cb: Listener<PermissionChangeEvent>) => void;
    };
    readonly Session: {
        /** Özel olay / outcome; in-app olay tetiklerini de değerlendirir. */
        sendEvent: (name: string, properties?: Record<string, unknown>, value?: number) => Promise<void>;
    };
    readonly InAppMessages: {
        addTrigger: (key: string, value: InAppTriggerValue) => Promise<void>;
        addTriggers: (triggers: Record<string, InAppTriggerValue>) => Promise<void>;
        removeTrigger: (key: string) => Promise<void>;
        removeTriggers: (keys: string[]) => Promise<void>;
        clearTriggers: () => Promise<void>;
        getTriggers: () => Promise<Record<string, string>>;
        /** Geçerli ekran adı (`screen` tetikleri); ekrandan çıkarken `null`. */
        setScreen: (name: string | null) => Promise<void>;
        /** true iken yeni mesaj gösterilmez (tetikler kaydedilmeye devam eder). */
        setPaused: (paused: boolean) => Promise<void>;
        getPaused: () => Promise<boolean>;
        addClickListener: (cb: Listener<InAppClickEvent>) => (() => void);
        removeClickListener: (cb: Listener<InAppClickEvent>) => void;
        addLifecycleListener: (listener: InAppLifecycleListener) => (() => void);
        removeLifecycleListener: (listener: InAppLifecycleListener) => void;
    };
    readonly Inbox: {
        /** Öğeler (yeniden eskiye), okunmamış sayısı ve sonraki sayfa imleci. */
        list: (options?: InboxListOptions) => Promise<InboxPage>;
        markRead: (id: string) => Promise<InboxItem>;
        /** Tümünü okundu işaretler; kalan okunmamış sayısını döndürür. */
        markAllRead: () => Promise<number>;
        /** Öğeyi kutudan kaldırır (sunucuda arşivlenir). */
        archive: (id: string) => Promise<void>;
        unreadCount: () => Promise<number>;
    };
    readonly ContentCards: {
        /** Kart akışı (sabitlenmiş → öncelik → yeni) ve görülmemiş kart sayısı; `limit` 1-100 (varsayılan 50). */
        list: (limit?: number) => Promise<ContentCardFeed>;
        /** Kart ekranda gösterildi (ilk gösterim kaydedilir). */
        logImpression: (id: string) => Promise<ContentCard>;
        /** Karta tıklandı (gösterim de sayılır). */
        logClick: (id: string) => Promise<ContentCard>;
        /** Kart kapatıldı; akıştan kalkar. */
        dismiss: (id: string) => Promise<ContentCard>;
    };
    private cardEvent;
    /**
     * Canlı sohbet (Android ve iOS): ziyaretçi kimliği, çevrimdışı kuyruk, canlı akış (SSE + yoklama yedeği) ve push ile
     * gelen mesajlar native SDK'dadır; login/logout ve push aboneliği değişince bağlama native SDK'da yenilenir.
     */
    readonly Chat: {
        /** Sohbeti etkinleştirir ve ziyaretçiyi bağlar (giriş yapmış kullanıcı, push aboneliği); konuşma varsa döner. */
        start: (options?: ChatStartOptions) => Promise<ChatIdentifyResult>;
        /** Widget ayarları, çevrimiçi durumu, çevrimdışı metni ve ek sınırları. */
        getConfig: (language?: string) => Promise<ChatConfig>;
        /** Konuşma (yoksa null) ve okunmamış sayısı. */
        getConversation: () => Promise<ChatConversationState>;
        /** Mesajlar (kronolojik): parametresiz en yeni `limit`; `afterSeq` sonrakiler, `beforeSeq` daha eski geçmiş. */
        getMessages: (options?: ChatMessagesOptions) => Promise<ChatMessagePage>;
        /**
         * Mesaj gönderir (ilk mesaj konuşmayı açar); `optionId` bot sorusunda seçilen hızlı yanıttır. Ağ yoksa mesaj native
         * kuyruğa alınır ve `pending` mesaj döner; gönderilince `message` olayıyla sunucu kopyası gelir.
         */
        sendMessage: (text: string, options?: {
            optionId?: string;
        }) => Promise<ChatMessage>;
        /** Ek gönderir (PNG/JPEG/WebP/GIF/PDF/düz metin, en çok 10 MB). */
        sendAttachment: (source: ChatAttachmentSource, options: ChatAttachmentOptions) => Promise<ChatMessage>;
        /** `seq` numarasına kadar okundu işaretler; kalan okunmamış sayısını döndürür. */
        markRead: (seq: number) => Promise<number>;
        /** Okunmamış sayısını sunucudan yeniler. */
        refreshUnreadCount: () => Promise<number>;
        /** Son bilinen okunmamış sayısı (ağ çağrısı yok). */
        getUnreadCount: () => Promise<number>;
        /** Çevrimdışı / çalışma saatleri dışında e-postayla mesaj bırakır. */
        leaveOfflineMessage: (email: string, text: string, name?: string) => Promise<ChatMessage>;
        /** Yazıyor göstergesi (native SDK tekrarları seyreltir). */
        setTyping: (typing: boolean) => Promise<void>;
        /** Canlı dinlemeyi başlatır; koparsa native SDK geri çekilmeyle yeniden bağlanır ve eksikleri yoklar. */
        startListening: () => Promise<void>;
        /** Canlı dinlemeyi durdurur (arka plana geçişte önerilir; temsilci mesajı push ile gelir). */
        stopListening: () => Promise<void>;
        /** Ek dosyasının adresi; ziyaretçi belirtecini taşır, yalnızca görsel bileşenine verin ve loglamayın. */
        attachmentUrl: (attachmentId: string, download?: boolean) => Promise<string>;
        /** Canlı dinleme açık mı (`startListening` çağrıldı ve akış etkin). Web'de her zaman false. */
        isListening: () => Promise<boolean>;
        /** Bu cihazın ziyaretçi kimliği (sohbet henüz kullanılmadıysa null). */
        getVisitorId: () => Promise<string | null>;
        /** Sohbet olay dinleyicisi; kaldırma fonksiyonu döner. `open`: sohbet bildirimine tıklama. */
        addEventListener: <K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>) => (() => void);
        removeEventListener: <K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>) => void;
    };
    /** Native sohbet olayını türüne göre dağıtır. */
    private onChatEvent;
    private onChatOpen;
    /**
     * Özellik bayrakları: değerler native SDK'da oturum başında yenilenir ve cihazda saklanır; ağ yoksa son değer, hiç
     * alınmadıysa verilen varsayılan döner. Gizlilik onayı beklenirken istek gönderilmez.
     */
    readonly FeatureFlags: {
        /** Değerleri sunucudan hemen yeniler; yeni değerler alındıysa true (hata son değerleri korur). */
        refresh: () => Promise<boolean>;
        /** Bayrak bu kullanıcı için açık mı; değer henüz yoksa `defaultValue`. */
        isEnabled: (key: string, defaultValue?: boolean) => Promise<boolean>;
        /** Bayrağın değeri (metin, sayı, mantıksal, nesne veya dizi); değer yoksa `defaultValue`. */
        getValue: <T extends FeatureFlagValue = FeatureFlagValue>(key: string, defaultValue?: T | null) => Promise<T | null>;
    };
    /**
     * Gömülü yerleşimler: uygulamanın ayırdığı alana içerik. Model döner, çizim uygulamanındır; içerik ekrana gelince
     * `reportImpression`, düğme tıklanınca `reportClick`, kapatılınca `reportDismiss` çağrılır.
     */
    readonly Placements: {
        /** Alanın içeriği (`limit` 1-10, varsayılan 1). Abonelik yoksa veya gizlilik onayı bekleniyorsa boş döner. */
        list: (key: string, options?: PlacementListOptions) => Promise<InAppMessage[]>;
        /** Raporlar `list` ile alınmış mesaj içindir; native katmanın tanımadığı mesaj yok sayılır. */
        reportImpression: (message: Pick<InAppMessage, "id">) => Promise<void>;
        reportClick: (message: Pick<InAppMessage, "id">, buttonId: string) => Promise<void>;
        reportDismiss: (message: Pick<InAppMessage, "id">) => Promise<void>;
    };
    /**
     * Konum paylaşımı (yalnızca ön plan; arka planda koordinat toplanmaz, bölge izleme için `setGeofencingEnabled`).
     * Paylaşım açıkken native SDK konumu oturum başında ve uygulama ön plana döndüğünde en sık 5 dakikada bir push
     * aboneliğine yazar; izin yoksa veya gizlilik onayı verilmemişse hiçbir şey gönderilmez. İlk konum sunucuda KVKK açık
     * rıza kaydı sayılır; `setShared(false)` konumu ve rıza kaydını sildirir. Tercih kalıcıdır. `initialize` öncesinde
     * `setShared`/`requestPermission`/`setGeofencingEnabled` `NOT_READY` ile reddedilir (web: Web SDK hatası).
     */
    readonly Location: {
        /** Paylaşımı açar/kapatır (kalıcı). Açılırken izin varsa konum hemen gönderilir; izin için `requestPermission`. */
        setShared: (shared: boolean) => Promise<void>;
        /**
         * Paylaşım açık mı (kalıcı tercih; izin durumundan bağımsız). Native SDK'larda özelliktir (`isShared`); köprü
         * asenkron olduğundan burada Promise döndüren fonksiyondur.
         */
        isShared: () => Promise<boolean>;
        /**
         * Konum iznini ister (Android `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION`, iOS "kullanırken"). İzin yoksa önce
         * açıklama gösterilir (`rationale`; verilmezse SDK'nın yerelleştirilmiş metni), kullanıcı vazgeçerse sistem istemi
         * açılmaz. Sonuç: izin varsa veya verildiyse true; reddedildiyse, uygulama izni tanımlamadıysa veya vazgeçildiyse false.
         */
        requestPermission: (rationale?: string) => Promise<boolean>;
        /** Ön plan konum izni verilmiş mi (Android yaklaşık/hassas, iOS "kullanırken" veya "her zaman"). Web'de false. */
        permissionGranted: () => Promise<boolean>;
        /** Arka plan konum izni verilmiş mi (Android `ACCESS_BACKGROUND_LOCATION`, iOS "her zaman"). Web'de false. */
        backgroundPermissionGranted: () => Promise<boolean>;
        /**
         * Arka plan konum iznini ister (bölge izleme için). Android: açıklama diyaloğu (`rationale`; verilmezse SDK metni),
         * ardından `ACCESS_BACKGROUND_LOCATION` (Android 11+ sistem Ayarlar ekranını açar; önce ön plan konum izni verilmiş
         * olmalı). iOS: "her zaman" izni (`rationale` yok sayılır; önce "kullanırken" izni verilmiş olmalı). Sonuç: izin
         * varsa veya verildiyse true; reddedildiyse, uygulama izni tanımlamadıysa veya vazgeçildiyse false. Web'de false.
         */
        requestBackgroundPermission: (rationale?: string) => Promise<boolean>;
        /** `requestBackgroundPermission` ile aynı izin (iOS adı: "her zaman"); iki ad da her platformda çalışır. */
        requestAlwaysPermission: () => Promise<boolean>;
        /**
         * Arka plan bölge izlemeyi açar/kapatır (ADR-0065; kalıcı, varsayılan kapalı). İzlemeyi işletim sistemi yapar,
         * sunucuya koordinat gitmez. `setShared(true)` ve arka plan konum izni gerekir (`requestBackgroundPermission`);
         * köprü manifest/Info.plist'e izin eklemez.
         */
        setGeofencingEnabled: (enabled: boolean) => Promise<void>;
        /** Bölge izleme açık mı (kalıcı tercih; izin durumundan bağımsız). */
        isGeofencingEnabled: () => Promise<boolean>;
    };
    /**
     * Mobil reklam kimliği (Android GAID, iOS IDFA). SDK reklam kitaplığı ve izin istemi içermez: kimliği uygulama alır
     * (Android `AdvertisingIdClient`, iOS App Tracking Transparency izninden sonra `ASIdentifierManager`) ve buraya verir.
     * Kimlik reklam kitlesine yalnızca `ads_personalization` rızası olan kullanıcıda ve SHA-256 özetiyle gider.
     */
    readonly Ads: {
        /** Reklam kimliğini yazar; `null` veya sıfır kimlik sunucudaki kaydı siler. Web'de etkisizdir. */
        setAdvertisingId: (id: string | null) => Promise<void>;
    };
    /**
     * Android teslimat güçlendirme: bazı üreticilerin pil/otomatik başlatma yöneticisi arka plandaki uygulamayı durdurduğu
     * için bildirimler gecikir ya da gelmez. Bu yüzey cihazdaki kısıtları okur ve kullanıcıyı ilgili ayar ekranına götürür.
     * Yalnızca Android'de etkilidir: iOS ve web'de `status()` `supported: false` ve `risk: 'none'` döner, `openSettings` ile
     * `showGuidance` hiçbir şey yapmadan `false` döner.
     */
    readonly Delivery: {
        /** Cihazın teslim durumu: üretici, ROM, pil muafiyeti, arka plan kısıtı, risk ve önerilen ayar ekranları. */
        status: () => Promise<DeliveryStatus>;
        /** Hazır açıklama diyaloğu şimdi gösterilmeli mi: teslim riski var ve diyalog son `minIntervalDays` günde gösterilmedi. */
        shouldShowGuidance: (minIntervalDays?: number) => Promise<boolean>;
        /**
         * Ayar ekranını açar (`auto`: duruma en uygun ekran). Üreticiye özgü ekran bulunamazsa standart Android ekranına
         * düşülür. Bir ekran açıldıysa true.
         */
        openSettings: (setting?: DeliverySetting) => Promise<boolean>;
        /**
         * Hazır açıklama diyaloğunu gösterir (22 dil; `message` verilirse SDK metni yerine o gösterilir). Kullanıcı kabul
         * ederse `setting` ekranı açılır. Ayar ekranı açıldıysa true; kullanıcı vazgeçtiyse, ekran açılamadıysa ya da etkin
         * Activity yoksa false. SDK diyaloğu kendiliğinden göstermez; uygun anı uygulama seçer (`shouldShowGuidance`).
         */
        showGuidance: (options?: DeliveryGuidanceOptions) => Promise<boolean>;
    };
    /**
     * iOS Live Activities (ADR-0024; iOS 16.1+). Köprü genel `PushizoDefaultLiveActivityAttributes` türünü kullanır;
     * widget extension'da bu türle `ActivityConfiguration` tanımlanmalı ve sunucuda tür adı aynen kaydedilmelidir.
     * Android ve web `PLATFORM_NOT_SUPPORTED` koduyla reddeder.
     */
    readonly LiveActivities: {
        /**
         * Genel türü izlemeye alır: push-to-start belirteci (iOS 17.2+) ve başlayan her etkinliğin güncelleme belirteci
         * sunucuya kaydedilir. `initialize`'dan sonra, uygulama her açıldığında çağrılmalıdır.
         */
        setupDefaultLiveActivity: () => Promise<void>;
        /**
         * Genel türle yerel bir etkinlik başlatır (iOS 16.1+); sunucu sonraki `update`/`end` çağrılarını `activityId` ile
         * yapar. `attributes` içinde `pushizo` anahtarı ayrılmıştır.
         */
        startDefaultLiveActivity: (activityId: string, attributes: Record<string, LiveActivityValue>, contentState: Record<string, LiveActivityValue>) => Promise<void>;
    };
    readonly Debug: {
        setLogLevel: (level: LogLevel) => Promise<void>;
    };
}
export {};
