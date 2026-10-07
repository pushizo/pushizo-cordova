import type { ForegroundWillDisplayEvent, HeroSignalNotification, InAppClickEvent, InAppLifecycleListener, InAppTriggerValue, InboxItem, InboxListOptions, InboxPage, InitializeOptions, LogLevel, NotificationClickEvent, PermissionChangeEvent, PushSubscriptionState } from './definitions';
/** Native katmandan gelen olay adları. */
export type BridgeEventType = 'click' | 'foregroundWillDisplay' | 'pushSubscriptionChange' | 'permissionChange' | 'inAppClick' | 'inAppLifecycle';
/** Taşıma katmanı: native metot çağrısı ve olay aboneliği. */
export interface Bridge {
    call<T = void>(method: string, args?: Record<string, unknown>): Promise<T>;
    /** Tüm native olaylarını tek işleyiciye bağlar; cephe yalnızca bir kez çağırır. */
    subscribe(handler: (type: BridgeEventType, payload: unknown) => void): void | Promise<void>;
}
type Listener<T> = (event: T) => void;
/** Native bildirim nesnesini eksik alanlara karşı normalize eder. */
export declare function normalizeNotification(raw: Partial<HeroSignalNotification> | undefined): HeroSignalNotification;
/** Uygulamaların kullandığı HeroSignal cephesi. */
export declare class HeroSignalCore {
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
    /** KVKK/GDPR onayı (`requiresPrivacyConsent: true` ile başlatıldıysa). */
    setConsentGiven(given: boolean): Promise<void>;
    /** Anonim kullanıcıyı kimlikli kullanıcıya bağlar; identity verification açıksa `identityHash` zorunludur. */
    login(externalId: string, identityHash?: string): Promise<void>;
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
        /** Tepsideki/bildirim merkezindeki tüm HeroSignal bildirimlerini kaldırır ve rozeti sıfırlar. */
        clearAll: () => Promise<void>;
        /** Yalnızca Android: tek bildirimi `notification.androidNotificationId` ile kaldırır (iOS/web'de etkisiz). */
        removeNotification: (androidNotificationId: number) => Promise<void>;
        /** Aynı gruptaki bildirimleri kaldırır (Android `android_group`, iOS `thread-id`). */
        removeGroupedNotifications: (group: string) => Promise<void>;
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
    readonly Debug: {
        setLogLevel: (level: LogLevel) => Promise<void>;
    };
}
export {};
