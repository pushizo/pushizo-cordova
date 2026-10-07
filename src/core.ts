/*
 * HeroSignal köprü cephesi (plan 06 §6.1 ortak yüzey). Taşıma katmanından bağımsızdır:
 * Capacitor eklentisi ve Cordova `cordova.exec` köprüsü aynı cepheyi kullanır
 * (`sdk/capacitor/src/core.ts` ile aynı içerik; değişiklik iki pakete birlikte yapılır).
 * Native olaylar tek noktadan alınır, JS dinleyicilerine dağıtılır; ön plan gösterim kararı
 * ve soğuk başlatma tıklama tamponu burada yönetilir.
 */
import type {
  ForegroundWillDisplayEvent,
  HeroSignalNotification,
  InAppClickEvent,
  InAppLifecycleEvent,
  InAppLifecycleListener,
  InAppTriggerValue,
  InboxItem,
  InboxListOptions,
  InboxPage,
  InitializeOptions,
  LogLevel,
  NotificationClickEvent,
  PermissionChangeEvent,
  PushSubscriptionState,
  RawForegroundEvent,
  RawInAppLifecycleEvent,
} from './definitions';

/** Native katmandan gelen olay adları. */
export type BridgeEventType =
  | 'click'
  | 'foregroundWillDisplay'
  | 'pushSubscriptionChange'
  | 'permissionChange'
  | 'inAppClick'
  | 'inAppLifecycle';

/** Taşıma katmanı: native metot çağrısı ve olay aboneliği. */
export interface Bridge {
  call<T = void>(method: string, args?: Record<string, unknown>): Promise<T>;
  /** Tüm native olaylarını tek işleyiciye bağlar; cephe yalnızca bir kez çağırır. */
  subscribe(handler: (type: BridgeEventType, payload: unknown) => void): void | Promise<void>;
}

type Listener<T> = (event: T) => void;

const LOG_LEVELS: readonly LogLevel[] = ['none', 'error', 'warn', 'info', 'debug'];
const LIFECYCLE_EVENTS = ['willDisplay', 'didDisplay', 'willDismiss', 'didDismiss'] as const;

/** Dinleyici hatası diğer dinleyicileri ve native köprüyü etkilemez. */
function safeInvoke<T>(listener: Listener<T>, event: T): void {
  try {
    listener(event);
  } catch (err) {
    console.error('[HeroSignal] dinleyici hatası', err);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`HeroSignal: ${name} boş olmayan bir metin olmalı.`);
  }
  return value;
}

function stringRecord(input: Record<string, unknown>, name: string): Record<string, string> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`HeroSignal: ${name} bir nesne olmalı.`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`HeroSignal: ${name}.${key} metin, sayı veya boolean olmalı.`);
    }
    out[key] = String(value);
  }
  return out;
}

/** Native bildirim nesnesini eksik alanlara karşı normalize eder. */
export function normalizeNotification(raw: Partial<HeroSignalNotification> | undefined): HeroSignalNotification {
  const n = raw ?? {};
  return {
    title: n.title ?? null,
    body: n.body ?? null,
    url: n.url ?? null,
    imageUrl: n.imageUrl ?? null,
    deliveryId: n.deliveryId ?? null,
    messageId: n.messageId ?? null,
    data: n.data ?? {},
    androidNotificationId: typeof n.androidNotificationId === 'number' ? n.androidNotificationId : null,
  };
}

/** Uygulamaların kullandığı HeroSignal cephesi. */
export class HeroSignalCore {
  private subscribed = false;
  private subscribing: Promise<void> | null = null;
  private readonly clickListeners = new Set<Listener<NotificationClickEvent>>();
  private readonly foregroundListeners = new Set<Listener<ForegroundWillDisplayEvent>>();
  private readonly subscriptionObservers = new Set<Listener<PushSubscriptionState>>();
  private readonly permissionObservers = new Set<Listener<PermissionChangeEvent>>();
  private readonly inAppClickListeners = new Set<Listener<InAppClickEvent>>();
  private readonly inAppLifecycleListeners = new Set<InAppLifecycleListener>();
  /** Dinleyici yokken gelen tıklamalar (soğuk başlatma); ilk dinleyiciye teslim edilir. */
  private readonly pendingClicks: NotificationClickEvent[] = [];
  private foregroundFlag = false;

  constructor(private readonly bridge: Bridge) {}

  // --- Olay altyapısı ---

  /** Native olaylarına bir kez abone olur (initialize veya ilk dinleyicide). */
  private ensureSubscribed(): Promise<void> {
    if (this.subscribed) return Promise.resolve();
    if (!this.subscribing) {
      this.subscribing = Promise.resolve(this.bridge.subscribe((type, payload) => this.dispatch(type, payload)))
        .then(() => {
          this.subscribed = true;
        })
        .catch((err) => {
          this.subscribing = null;
          throw err;
        });
    }
    return this.subscribing;
  }

  /** Native olayını ilgili dinleyicilere dağıtır (test ve taşıma katmanı için açık). */
  dispatch(type: BridgeEventType, payload: unknown): void {
    switch (type) {
      case 'click':
        this.onClick(payload as NotificationClickEvent);
        break;
      case 'foregroundWillDisplay':
        this.onForeground(payload as RawForegroundEvent);
        break;
      case 'pushSubscriptionChange': {
        const state = payload as PushSubscriptionState;
        this.subscriptionObservers.forEach((l) => safeInvoke(l, state));
        break;
      }
      case 'permissionChange': {
        const event = { permission: Boolean((payload as PermissionChangeEvent).permission) };
        this.permissionObservers.forEach((l) => safeInvoke(l, event));
        break;
      }
      case 'inAppClick': {
        const raw = payload as InAppClickEvent;
        const event: InAppClickEvent = {
          message: { id: raw.message.id },
          result: { actionId: raw.result.actionId, url: raw.result.url ?? null },
        };
        this.inAppClickListeners.forEach((l) => safeInvoke(l, event));
        break;
      }
      case 'inAppLifecycle': {
        const raw = payload as RawInAppLifecycleEvent;
        if (!LIFECYCLE_EVENTS.includes(raw.event)) return;
        const event: InAppLifecycleEvent = { event: raw.event, message: { id: raw.message.id } };
        this.inAppLifecycleListeners.forEach((l) => {
          const fn = l[raw.event];
          if (fn) safeInvoke(fn.bind(l), event);
        });
        break;
      }
      default:
        break;
    }
  }

  private onClick(raw: NotificationClickEvent): void {
    const event: NotificationClickEvent = {
      notification: normalizeNotification(raw.notification),
      result: { actionId: raw.result?.actionId ?? null, url: raw.result?.url ?? null },
    };
    if (this.clickListeners.size === 0) {
      this.pendingClicks.push(event);
      return;
    }
    this.clickListeners.forEach((l) => safeInvoke(l, event));
  }

  /**
   * Ön plan kararı: dinleyiciler senkron çalışır; hiçbiri `preventDefault()` çağırmadıysa ve native
   * gösterimi bekletiyorsa (`pending`) bildirim hemen gösterilir.
   */
  private onForeground(raw: RawForegroundEvent): void {
    let prevented = false;
    let displayed = false;
    const rawPrevent = (raw as { preventDefault?: () => void }).preventDefault;
    const bridge = this.bridge;
    const event: ForegroundWillDisplayEvent = {
      notification: normalizeNotification(raw.notification),
      preventDefault: () => {
        prevented = true;
        // Capacitor web: tarayıcı gösterimi senkron engellenir (native köprülerde bu alan yoktur).
        if (typeof rawPrevent === 'function') rawPrevent();
      },
      display: async () => {
        if (displayed) return;
        displayed = true;
        await bridge.call('displayNotification', { notificationId: raw.notificationId });
      },
      get prevented() {
        return prevented;
      },
    };
    this.foregroundListeners.forEach((l) => safeInvoke(l, event));
    if (raw.pending && !prevented) {
      event.display().catch((err) => console.error('[HeroSignal] bildirim gösterilemedi', err));
    }
  }

  private syncForegroundFlag(): void {
    const enabled = this.foregroundListeners.size > 0;
    if (enabled === this.foregroundFlag) return;
    this.foregroundFlag = enabled;
    this.bridge
      .call('setForegroundHandlerEnabled', { enabled })
      .catch((err) => console.error('[HeroSignal] ön plan işleyicisi ayarlanamadı', err));
  }

  private listen<T>(set: Set<T>, listener: T): () => void {
    if (typeof listener !== 'function' && (typeof listener !== 'object' || listener === null)) {
      throw new TypeError('HeroSignal: dinleyici bir fonksiyon olmalı.');
    }
    set.add(listener);
    this.ensureSubscribed().catch((err) => console.error('[HeroSignal] olaylara abone olunamadı', err));
    return () => {
      set.delete(listener);
    };
  }

  // --- Başlatma, kimlik, gizlilik ---

  /** SDK'yı başlatır; olay aboneliği burada kurulur. */
  async initialize(appIdOrOptions: string | InitializeOptions, options: Omit<InitializeOptions, 'appId'> = {}): Promise<void> {
    const opts: InitializeOptions =
      typeof appIdOrOptions === 'string' ? { ...options, appId: appIdOrOptions } : { ...appIdOrOptions };
    requireString(opts.appId, 'appId');
    if (opts.logLevel !== undefined && !LOG_LEVELS.includes(opts.logLevel)) {
      throw new TypeError(`HeroSignal: logLevel ${LOG_LEVELS.join('|')} olmalı.`);
    }
    await this.ensureSubscribed();
    await this.bridge.call('initialize', opts as unknown as Record<string, unknown>);
    if (this.foregroundListeners.size > 0) {
      this.foregroundFlag = true;
      await this.bridge.call('setForegroundHandlerEnabled', { enabled: true });
    }
  }

  /** KVKK/GDPR onayı (`requiresPrivacyConsent: true` ile başlatıldıysa). */
  setConsentGiven(given: boolean): Promise<void> {
    return this.bridge.call('setConsentGiven', { given: Boolean(given) });
  }

  /** Anonim kullanıcıyı kimlikli kullanıcıya bağlar; identity verification açıksa `identityHash` zorunludur. */
  login(externalId: string, identityHash?: string): Promise<void> {
    requireString(externalId, 'externalId');
    const args: Record<string, unknown> = { externalId };
    if (identityHash !== undefined && identityHash !== null) args.identityHash = requireString(identityHash, 'identityHash');
    return this.bridge.call('login', args);
  }

  logout(): Promise<void> {
    return this.bridge.call('logout');
  }

  // --- Kullanıcı ---

  readonly User = {
    addTag: (key: string, value: InAppTriggerValue): Promise<void> =>
      this.bridge.call('addTags', { tags: stringRecord({ [requireString(key, 'key')]: value }, 'tags') }),
    addTags: (tags: Record<string, InAppTriggerValue>): Promise<void> =>
      this.bridge.call('addTags', { tags: stringRecord(tags, 'tags') }),
    removeTag: (key: string): Promise<void> => this.bridge.call('removeTags', { keys: [requireString(key, 'key')] }),
    removeTags: (keys: string[]): Promise<void> =>
      this.bridge.call('removeTags', { keys: keys.map((k) => requireString(k, 'key')) }),
    getTags: async (): Promise<Record<string, string>> =>
      (await this.bridge.call<{ tags: Record<string, string> }>('getTags')).tags ?? {},
    setLanguage: (code: string): Promise<void> => this.bridge.call('setLanguage', { code: requireString(code, 'code') }),
    addAlias: (label: string, id: string): Promise<void> =>
      this.bridge.call('addAliases', { aliases: { [requireString(label, 'label')]: requireString(id, 'id') } }),
    addAliases: (aliases: Record<string, string>): Promise<void> =>
      this.bridge.call('addAliases', { aliases: stringRecord(aliases, 'aliases') }),
    removeAlias: (label: string): Promise<void> => this.bridge.call('removeAlias', { label: requireString(label, 'label') }),
    addEmail: (email: string): Promise<void> => this.bridge.call('addEmail', { email: requireString(email, 'email') }),
    removeEmail: (email: string): Promise<void> => this.bridge.call('removeEmail', { email: requireString(email, 'email') }),
    addSms: (phoneNumber: string): Promise<void> =>
      this.bridge.call('addSms', { phoneNumber: requireString(phoneNumber, 'phoneNumber') }),
    removeSms: (phoneNumber: string): Promise<void> =>
      this.bridge.call('removeSms', { phoneNumber: requireString(phoneNumber, 'phoneNumber') }),
    getExternalId: async (): Promise<string | null> =>
      (await this.bridge.call<{ externalId: string | null }>('getUser')).externalId ?? null,
    getId: async (): Promise<string | null> => (await this.bridge.call<{ id: string | null }>('getUser')).id ?? null,
    pushSubscription: {
      getState: (): Promise<PushSubscriptionState> => this.bridge.call<PushSubscriptionState>('getPushSubscription'),
      getId: async (): Promise<string | null> =>
        (await this.bridge.call<PushSubscriptionState>('getPushSubscription')).id ?? null,
      getToken: async (): Promise<string | null> =>
        (await this.bridge.call<PushSubscriptionState>('getPushSubscription')).token ?? null,
      getOptedIn: async (): Promise<boolean> =>
        Boolean((await this.bridge.call<PushSubscriptionState>('getPushSubscription')).optedIn),
      optIn: (): Promise<void> => this.bridge.call('optIn'),
      optOut: (): Promise<void> => this.bridge.call('optOut'),
      /** Token/abonelik/izin değişimi; dönen fonksiyon aboneliği kaldırır. */
      addObserver: (cb: Listener<PushSubscriptionState>): (() => void) => this.listen(this.subscriptionObservers, cb),
      removeObserver: (cb: Listener<PushSubscriptionState>): void => {
        this.subscriptionObservers.delete(cb);
      },
    },
  };

  // --- Bildirimler ---

  readonly Notifications = {
    /** Sistem bildirim izni (Android 13+ POST_NOTIFICATIONS, iOS UNAuthorization). */
    getPermission: async (): Promise<boolean> =>
      Boolean((await this.bridge.call<{ permission: boolean }>('getPermission')).permission),
    /** İzin ister; sonuç izin durumudur. */
    requestPermission: async (): Promise<boolean> =>
      Boolean((await this.bridge.call<{ permission: boolean }>('requestPermission')).permission),
    /** Tepsideki/bildirim merkezindeki tüm HeroSignal bildirimlerini kaldırır ve rozeti sıfırlar. */
    clearAll: (): Promise<void> => this.bridge.call('clearAll'),
    /** Yalnızca Android: tek bildirimi `notification.androidNotificationId` ile kaldırır (iOS/web'de etkisiz). */
    removeNotification: (androidNotificationId: number): Promise<void> => {
      if (!Number.isInteger(androidNotificationId)) throw new TypeError('HeroSignal: androidNotificationId tamsayı olmalı.');
      return this.bridge.call('removeNotification', { id: androidNotificationId });
    },
    /** Aynı gruptaki bildirimleri kaldırır (Android `android_group`, iOS `thread-id`). */
    removeGroupedNotifications: (group: string): Promise<void> =>
      this.bridge.call('removeGroupedNotifications', { group: requireString(group, 'group') }),
    /** Bildirim/düğme tıklaması; soğuk başlatmada bekleyen tıklama ilk dinleyiciye teslim edilir. */
    addClickListener: (cb: Listener<NotificationClickEvent>): (() => void) => {
      const remove = this.listen(this.clickListeners, cb);
      const pending = this.pendingClicks.splice(0);
      pending.forEach((e) => safeInvoke(cb, e));
      return remove;
    },
    removeClickListener: (cb: Listener<NotificationClickEvent>): void => {
      this.clickListeners.delete(cb);
    },
    /** Ön planda gelen bildirim; `event.preventDefault()` gösterimi engeller, `event.display()` gösterir. */
    addForegroundLifecycleListener: (cb: Listener<ForegroundWillDisplayEvent>): (() => void) => {
      const remove = this.listen(this.foregroundListeners, cb);
      this.syncForegroundFlag();
      return () => {
        remove();
        this.syncForegroundFlag();
      };
    },
    removeForegroundLifecycleListener: (cb: Listener<ForegroundWillDisplayEvent>): void => {
      this.foregroundListeners.delete(cb);
      this.syncForegroundFlag();
    },
    /** İzin değişimi (istem sonucu veya kullanıcının sistem ayarlarından değiştirmesi). */
    addPermissionObserver: (cb: Listener<PermissionChangeEvent>): (() => void) =>
      this.listen(this.permissionObservers, cb),
    removePermissionObserver: (cb: Listener<PermissionChangeEvent>): void => {
      this.permissionObservers.delete(cb);
    },
  };

  // --- Oturum / olaylar ---

  readonly Session = {
    /** Özel olay / outcome; in-app olay tetiklerini de değerlendirir. */
    sendEvent: (name: string, properties?: Record<string, unknown>, value?: number): Promise<void> => {
      const args: Record<string, unknown> = { name: requireString(name, 'name'), properties: properties ?? {} };
      if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('HeroSignal: value sayı olmalı.');
        args.value = value;
      }
      return this.bridge.call('sendEvent', args);
    },
  };

  // --- In-app mesajlar ---

  readonly InAppMessages = {
    addTrigger: (key: string, value: InAppTriggerValue): Promise<void> =>
      this.bridge.call('addTriggers', { triggers: stringRecord({ [requireString(key, 'key')]: value }, 'triggers') }),
    addTriggers: (triggers: Record<string, InAppTriggerValue>): Promise<void> =>
      this.bridge.call('addTriggers', { triggers: stringRecord(triggers, 'triggers') }),
    removeTrigger: (key: string): Promise<void> => this.bridge.call('removeTriggers', { keys: [requireString(key, 'key')] }),
    removeTriggers: (keys: string[]): Promise<void> =>
      this.bridge.call('removeTriggers', { keys: keys.map((k) => requireString(k, 'key')) }),
    clearTriggers: (): Promise<void> => this.bridge.call('clearTriggers'),
    getTriggers: async (): Promise<Record<string, string>> =>
      (await this.bridge.call<{ triggers: Record<string, string> }>('getTriggers')).triggers ?? {},
    /** Geçerli ekran adı (`screen` tetikleri); ekrandan çıkarken `null`. */
    setScreen: (name: string | null): Promise<void> => this.bridge.call('setScreen', { name: name || null }),
    /** true iken yeni mesaj gösterilmez (tetikler kaydedilmeye devam eder). */
    setPaused: (paused: boolean): Promise<void> => this.bridge.call('setInAppPaused', { paused: Boolean(paused) }),
    getPaused: async (): Promise<boolean> =>
      Boolean((await this.bridge.call<{ paused: boolean }>('getInAppPaused')).paused),
    addClickListener: (cb: Listener<InAppClickEvent>): (() => void) => this.listen(this.inAppClickListeners, cb),
    removeClickListener: (cb: Listener<InAppClickEvent>): void => {
      this.inAppClickListeners.delete(cb);
    },
    addLifecycleListener: (listener: InAppLifecycleListener): (() => void) =>
      this.listen(this.inAppLifecycleListeners, listener),
    removeLifecycleListener: (listener: InAppLifecycleListener): void => {
      this.inAppLifecycleListeners.delete(listener);
    },
  };

  // --- Bildirim kutusu ---

  readonly Inbox = {
    /** Öğeler (yeniden eskiye), okunmamış sayısı ve sonraki sayfa imleci. */
    list: (options: InboxListOptions = {}): Promise<InboxPage> => {
      const limit = options.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return Promise.reject(new RangeError('HeroSignal: limit 1-200 olmalı.'));
      }
      const args: Record<string, unknown> = { limit };
      if (options.cursor) args.cursor = options.cursor;
      return this.bridge.call<InboxPage>('inboxList', args);
    },
    markRead: (id: string): Promise<InboxItem> => this.bridge.call<InboxItem>('inboxMarkRead', { id: requireString(id, 'id') }),
    /** Tümünü okundu işaretler; kalan okunmamış sayısını döndürür. */
    markAllRead: async (): Promise<number> =>
      (await this.bridge.call<{ unreadCount: number }>('inboxMarkAllRead')).unreadCount ?? 0,
    /** Öğeyi kutudan kaldırır (sunucuda arşivlenir). */
    archive: (id: string): Promise<void> => this.bridge.call('inboxArchive', { id: requireString(id, 'id') }),
    unreadCount: async (): Promise<number> =>
      (await this.bridge.call<{ unreadCount: number }>('inboxUnreadCount')).unreadCount ?? 0,
  };

  // --- Hata ayıklama ---

  readonly Debug = {
    setLogLevel: (level: LogLevel): Promise<void> => {
      if (!LOG_LEVELS.includes(level)) throw new TypeError(`HeroSignal: level ${LOG_LEVELS.join('|')} olmalı.`);
      return this.bridge.call('setLogLevel', { level });
    },
  };
}
