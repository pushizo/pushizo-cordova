/*
 * Pushizo köprü cephesi (plan 06 §6.1 ortak yüzey). Taşıma katmanından bağımsızdır:
 * Capacitor eklentisi ve Cordova `cordova.exec` köprüsü aynı cepheyi kullanır
 * (`sdk/capacitor/src/core.ts` ile aynı içerik; değişiklik iki pakete birlikte yapılır).
 * Native olaylar tek noktadan alınır, JS dinleyicilerine dağıtılır; ön plan gösterim kararı
 * ve soğuk başlatma tıklama tamponu burada yönetilir.
 */
import type {
  ChatAttachmentOptions,
  ChatAttachmentSource,
  ChatConfig,
  ChatConversationState,
  ChatEventMap,
  ChatIdentifyResult,
  ChatMessage,
  ChatMessagePage,
  ChatMessagesOptions,
  ChatStartOptions,
  ForegroundWillDisplayEvent,
  PushizoNotification,
  InAppClickEvent,
  InAppLifecycleEvent,
  InAppLifecycleListener,
  InAppTriggerValue,
  InboxItem,
  InboxListOptions,
  InboxPage,
  InitializeOptions,
  LiveActivityValue,
  LogLevel,
  LoginOptions,
  NotificationClickEvent,
  PermissionChangeEvent,
  PreferenceChannel,
  PreferenceInput,
  PushSubscriptionState,
  RawForegroundEvent,
  RawInAppLifecycleEvent,
  UserPreferences,
} from './definitions';

/** Native katmandan gelen olay adları. */
export type BridgeEventType =
  | 'click'
  | 'foregroundWillDisplay'
  | 'pushSubscriptionChange'
  | 'permissionChange'
  | 'inAppClick'
  | 'inAppLifecycle'
  | 'chatEvent'
  | 'chatOpen';

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
    console.error('[Pushizo] dinleyici hatası', err);
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Pushizo: ${name} boş olmayan bir metin olmalı.`);
  }
  return value;
}

function stringRecord(input: Record<string, unknown>, name: string): Record<string, string> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`Pushizo: ${name} bir nesne olmalı.`);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Pushizo: ${name}.${key} metin, sayı veya boolean olmalı.`);
    }
    out[key] = String(value);
  }
  return out;
}

const CHAT_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];

/** Sohbet metni: boş olmayan, en çok 4000 karakter (sunucu kuralı). */
function chatText(value: unknown): string {
  const text = requireString(value, 'text');
  if (text.trim().length > 4000) throw new RangeError('Pushizo: mesaj en fazla 4000 karakter olabilir.');
  return text;
}

function chatSeq(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new RangeError(`Pushizo: ${name} en az ${min} olan bir tam sayı olmalı.`);
  }
  return value;
}

/** Live Activity etkinlik kimliği: iOS SDK ve sunucu `start` kuralı (1-100 karakter; harf, rakam ve `_ . : -`). */
const LIVE_ACTIVITY_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_LIVE_ACTIVITY_KEY_LENGTH = 64;
/** Sunucunun uzaktan başlatmada `attributes` içine eklediği ayrılmış anahtar. */
const RESERVED_LIVE_ACTIVITY_KEY = 'pushizo';

function liveActivityId(value: unknown): string {
  if (typeof value !== 'string' || !LIVE_ACTIVITY_ID.test(value)) {
    throw new TypeError('Pushizo: activityId 1-100 karakter olmalı (harf, rakam ve _ . : -).');
  }
  return value;
}

/** Düz nesne; anahtar 1-64 karakter, değer metin / sonlu sayı / boolean (native SDK ile aynı kurallar). */
function liveActivityValues(input: unknown, name: string, reservedKey?: string): Record<string, LiveActivityValue> {
  const proto: unknown = input !== null && typeof input === 'object' ? Object.getPrototypeOf(input) : undefined;
  if (Array.isArray(input) || (proto !== Object.prototype && proto !== null)) {
    throw new TypeError(`Pushizo: ${name} düz bir nesne olmalı.`);
  }
  const out: Record<string, LiveActivityValue> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.length < 1 || key.length > MAX_LIVE_ACTIVITY_KEY_LENGTH) {
      throw new TypeError(`Pushizo: ${name} anahtarları 1-${MAX_LIVE_ACTIVITY_KEY_LENGTH} karakter olmalı.`);
    }
    if (key === reservedKey) throw new TypeError(`Pushizo: ${name} içinde '${reservedKey}' anahtarı ayrılmıştır.`);
    if (typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError(`Pushizo: ${name}.${key} metin, sonlu sayı veya boolean olmalı.`);
    }
    out[key] = value;
  }
  return out;
}

const PREFERENCE_CHANNELS: readonly PreferenceChannel[] = ['ios_push', 'android_push', 'web_push', 'email', 'sms'];

/** Native tercih yanıtı (alanlar eksik gelebilir; `normalizePreferences` tamamlar). */
type RawPreferences = Partial<UserPreferences> | null | undefined;

/** Native'e giden doğrulanmış tercih kaydı. */
interface PreferenceArg {
  category: string;
  channel: PreferenceChannel | null;
  optedIn: boolean;
}

/** `setPreferences` girdisini yerel SDK kurallarıyla doğrular: 1-100 kayıt, kategori 1-64 karakter, bilinen kanal. */
function preferenceArgs(input: PreferenceInput[]): PreferenceArg[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    throw new RangeError('Pushizo: preferences 1-100 kayıt olmalı.');
  }
  return input.map((p, i) => {
    if (p === null || typeof p !== 'object') throw new TypeError(`Pushizo: preferences[${i}] bir nesne olmalı.`);
    const category = requireString(p.category, `preferences[${i}].category`).trim();
    if (category.length > 64) throw new RangeError(`Pushizo: preferences[${i}].category en fazla 64 karakter olmalı.`);
    const channel = p.channel ?? null;
    if (channel !== null && !PREFERENCE_CHANNELS.includes(channel)) {
      throw new TypeError(`Pushizo: preferences[${i}].channel ${PREFERENCE_CHANNELS.join('|')} veya null olmalı.`);
    }
    if (typeof p.optedIn !== 'boolean') throw new TypeError(`Pushizo: preferences[${i}].optedIn boolean olmalı.`);
    return { category, channel, optedIn: p.optedIn };
  });
}

function textMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, text] of Object.entries(value)) if (typeof text === 'string') out[key] = text;
  return out;
}

/** `getContacts` yanıtı: bu cihazda kayıtlı e-posta adresleri ve SMS numaraları. */
type RawContacts = { emails?: unknown; smsNumbers?: unknown } | null | undefined;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Native tercih yanıtını eksik alanlara karşı normalize eder (zamanlar epoch milisaniye). */
function normalizePreferences(raw: RawPreferences): UserPreferences {
  const preferences = Array.isArray(raw?.preferences) ? raw.preferences : [];
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    preferences: preferences.map((p) => ({
      category: p.category,
      channel: p.channel ?? null,
      optedIn: p.optedIn === true,
      explicit: p.explicit === true,
      source: p.source ?? null,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : null,
    })),
    categories: categories.map((c) => ({
      key: c.key,
      name: textMap(c.name),
      description: textMap(c.description),
      channels: Array.isArray(c.channels) ? c.channels.filter((x): x is string => typeof x === 'string') : null,
      defaultOptedIn: c.defaultOptedIn !== false,
    })),
  };
}

/** Native bildirim nesnesini eksik alanlara karşı normalize eder. */
export function normalizeNotification(raw: Partial<PushizoNotification> | undefined): PushizoNotification {
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

/** Uygulamaların kullandığı Pushizo cephesi. */
export class PushizoCore {
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
  /** Canlı sohbet dinleyicileri (tür başına). */
  private readonly chatListeners: { [K in keyof ChatEventMap]: Set<Listener<ChatEventMap[K]>> } = {
    message: new Set(),
    typing: new Set(),
    read: new Set(),
    unread: new Set(),
    conversation: new Set(),
    connection: new Set(),
    error: new Set(),
    open: new Set(),
  };
  /** Dinleyici yokken gelen sohbet bildirimi tıklamaları (soğuk başlatma). */
  private readonly pendingChatOpens: ChatEventMap['open'][] = [];
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
      case 'chatEvent':
        this.onChatEvent((payload ?? {}) as Record<string, unknown>);
        break;
      case 'chatOpen':
        this.onChatOpen((payload ?? {}) as Record<string, unknown>);
        break;
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
      event.display().catch((err) => console.error('[Pushizo] bildirim gösterilemedi', err));
    }
  }

  private syncForegroundFlag(): void {
    const enabled = this.foregroundListeners.size > 0;
    if (enabled === this.foregroundFlag) return;
    this.foregroundFlag = enabled;
    this.bridge
      .call('setForegroundHandlerEnabled', { enabled })
      .catch((err) => console.error('[Pushizo] ön plan işleyicisi ayarlanamadı', err));
  }

  private listen<T>(set: Set<T>, listener: T): () => void {
    if (typeof listener !== 'function' && (typeof listener !== 'object' || listener === null)) {
      throw new TypeError('Pushizo: dinleyici bir fonksiyon olmalı.');
    }
    set.add(listener);
    this.ensureSubscribed().catch((err) => console.error('[Pushizo] olaylara abone olunamadı', err));
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
      throw new TypeError(`Pushizo: logLevel ${LOG_LEVELS.join('|')} olmalı.`);
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

  /**
   * Anonim kullanıcıyı kimlikli kullanıcıya bağlar. Identity verification açıksa app moduna göre `identityHash`
   * (eski imza: ikinci argüman metin) ve/veya JWT gerekir: `login(id, { jwt })`.
   */
  login(externalId: string, proof?: string | LoginOptions): Promise<void> {
    requireString(externalId, 'externalId');
    const { identityHash, jwt }: LoginOptions = typeof proof === 'string' ? { identityHash: proof } : (proof ?? {});
    const args: Record<string, unknown> = { externalId };
    if (identityHash !== undefined && identityHash !== null) args.identityHash = requireString(identityHash, 'identityHash');
    if (jwt !== undefined && jwt !== null) args.jwt = requireString(jwt, 'jwt');
    return this.bridge.call('login', args);
  }

  /** Süresi dolan kimlik JWT'sini yeniler (giriş yapmış kullanıcı için); sonraki SDK istekleri yeni belirteci taşır. */
  updateUserJwt(jwt: string): Promise<void> {
    return this.bridge.call('updateUserJwt', { jwt: requireString(jwt, 'jwt') });
  }

  /** Kullanıcıyı anonim kullanıcıya döndürür; kimlik JWT'si cihazdan silinir. */
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
    /** Bu cihazda `addEmail` ile kaydedilmiş e-posta adresleri (yerel kayıt; sunucu sorgulanmaz). */
    getEmails: async (): Promise<string[]> => stringArray((await this.bridge.call<RawContacts>('getContacts'))?.emails),
    /** Bu cihazda `addSms` ile kaydedilmiş SMS numaraları (E.164; yerel kayıt). */
    getSmsNumbers: async (): Promise<string[]> =>
      stringArray((await this.bridge.call<RawContacts>('getContacts'))?.smsNumbers),
    /**
     * Kullanıcının kategori/kanal tercihleri ve app kategorileri (ADR-0019 §4); sahiplik kanıtı yerel SDK'da eklenir.
     * Abonelik henüz yoksa `NOT_READY` koduyla reddedilir.
     */
    getPreferences: async (): Promise<UserPreferences> =>
      normalizePreferences(await this.bridge.call<RawPreferences>('getPreferences')),
    /** Tercihleri yazar (1-100 kayıt; `channel` verilmezse tüm kanallar); güncel listeyi döndürür. */
    setPreferences: async (preferences: PreferenceInput[]): Promise<UserPreferences> =>
      normalizePreferences(await this.bridge.call<RawPreferences>('setPreferences', { preferences: preferenceArgs(preferences) })),
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
    /** Tepsideki/bildirim merkezindeki tüm Pushizo bildirimlerini kaldırır ve rozeti sıfırlar. */
    clearAll: (): Promise<void> => this.bridge.call('clearAll'),
    /**
     * Tek bildirimi kaldırır. Android: `notification.androidNotificationId` (tamsayı). iOS: bildirim isteği kimliği
     * (`UNNotificationRequest.identifier`, metin; tamsayı verilirse metne çevrilir). Web'de `UNAVAILABLE`.
     */
    removeNotification: (id: number | string): Promise<void> => {
      if (typeof id === 'string') return this.bridge.call('removeNotification', { identifier: requireString(id, 'identifier') });
      if (!Number.isInteger(id)) throw new TypeError('Pushizo: androidNotificationId tamsayı olmalı.');
      return this.bridge.call('removeNotification', { id });
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
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Pushizo: value sayı olmalı.');
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
        return Promise.reject(new RangeError('Pushizo: limit 1-200 olmalı.'));
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

  // --- Canlı sohbet (ADR-0040) ---

  /**
   * Canlı sohbet (Android ve iOS): ziyaretçi kimliği, çevrimdışı kuyruk, canlı akış (SSE + yoklama yedeği) ve push ile
   * gelen mesajlar native SDK'dadır; login/logout ve push aboneliği değişince bağlama native SDK'da yenilenir.
   */
  readonly Chat = {
    /** Sohbeti etkinleştirir ve ziyaretçiyi bağlar (giriş yapmış kullanıcı, push aboneliği); konuşma varsa döner. */
    start: (options: ChatStartOptions = {}): Promise<ChatIdentifyResult> => {
      const args: Record<string, unknown> = {};
      if (options.name) args.name = options.name;
      if (options.email) args.email = options.email;
      if (options.language) args.language = options.language;
      return this.bridge.call<ChatIdentifyResult>('chatStart', args);
    },
    /** Widget ayarları, çevrimiçi durumu, çevrimdışı metni ve ek sınırları. */
    getConfig: (language?: string): Promise<ChatConfig> =>
      this.bridge.call<ChatConfig>('chatGetConfig', language ? { language } : {}),
    /** Konuşma (yoksa null) ve okunmamış sayısı. */
    getConversation: (): Promise<ChatConversationState> => this.bridge.call<ChatConversationState>('chatGetConversation'),
    /** Mesajlar (kronolojik): parametresiz en yeni `limit`; `afterSeq` sonrakiler, `beforeSeq` daha eski geçmiş. */
    getMessages: (options: ChatMessagesOptions = {}): Promise<ChatMessagePage> => {
      const limit = options.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return Promise.reject(new RangeError('Pushizo: limit 1-100 olmalı.'));
      }
      const args: Record<string, unknown> = { limit };
      try {
        if (options.afterSeq !== undefined) args.afterSeq = chatSeq(options.afterSeq, 'afterSeq', 0);
        if (options.beforeSeq !== undefined) args.beforeSeq = chatSeq(options.beforeSeq, 'beforeSeq', 1);
      } catch (err) {
        return Promise.reject(err);
      }
      return this.bridge.call<ChatMessagePage>('chatGetMessages', args);
    },
    /**
     * Mesaj gönderir (ilk mesaj konuşmayı açar); `optionId` bot sorusunda seçilen hızlı yanıttır. Ağ yoksa mesaj native
     * kuyruğa alınır ve `pending` mesaj döner; gönderilince `message` olayıyla sunucu kopyası gelir.
     */
    sendMessage: (text: string, options: { optionId?: string } = {}): Promise<ChatMessage> => {
      const args: Record<string, unknown> = { text: chatText(text) };
      if (options.optionId) args.optionId = options.optionId;
      return this.bridge.call<ChatMessage>('chatSendMessage', args);
    },
    /** Ek gönderir (PNG/JPEG/WebP/GIF/PDF/düz metin, en çok 10 MB). */
    sendAttachment: (source: ChatAttachmentSource, options: ChatAttachmentOptions): Promise<ChatMessage> => {
      const mime = requireString(options.mimeType, 'mimeType').split(';')[0].trim().toLowerCase();
      if (!CHAT_ATTACHMENT_TYPES.includes(mime)) {
        return Promise.reject(new TypeError(`Pushizo: desteklenmeyen dosya türü '${mime}'.`));
      }
      const args: Record<string, unknown> = { fileName: requireString(options.fileName, 'fileName'), mimeType: mime };
      if ('base64' in source) args.base64 = requireString(source.base64, 'base64');
      else args.uri = requireString(source.uri, 'uri');
      if (options.text && options.text.trim()) args.text = options.text;
      return this.bridge.call<ChatMessage>('chatSendAttachment', args);
    },
    /** `seq` numarasına kadar okundu işaretler; kalan okunmamış sayısını döndürür. */
    markRead: async (seq: number): Promise<number> =>
      (await this.bridge.call<{ unreadCount: number }>('chatMarkRead', { seq: chatSeq(seq, 'seq', 0) })).unreadCount ?? 0,
    /** Okunmamış sayısını sunucudan yeniler. */
    refreshUnreadCount: async (): Promise<number> =>
      (await this.bridge.call<{ unreadCount: number }>('chatRefreshUnreadCount')).unreadCount ?? 0,
    /** Son bilinen okunmamış sayısı (ağ çağrısı yok). */
    getUnreadCount: async (): Promise<number> =>
      (await this.bridge.call<{ unreadCount: number }>('chatGetUnreadCount')).unreadCount ?? 0,
    /** Çevrimdışı / çalışma saatleri dışında e-postayla mesaj bırakır. */
    leaveOfflineMessage: (email: string, text: string, name?: string): Promise<ChatMessage> => {
      const args: Record<string, unknown> = { email: requireString(email, 'email'), text: chatText(text) };
      if (name) args.name = name;
      return this.bridge.call<ChatMessage>('chatLeaveOfflineMessage', args);
    },
    /** Yazıyor göstergesi (native SDK tekrarları seyreltir). */
    setTyping: (typing: boolean): Promise<void> => this.bridge.call('chatSetTyping', { typing: Boolean(typing) }),
    /** Canlı dinlemeyi başlatır; koparsa native SDK geri çekilmeyle yeniden bağlanır ve eksikleri yoklar. */
    startListening: async (): Promise<void> => {
      await this.ensureSubscribed();
      return this.bridge.call('chatStartListening');
    },
    /** Canlı dinlemeyi durdurur (arka plana geçişte önerilir; temsilci mesajı push ile gelir). */
    stopListening: (): Promise<void> => this.bridge.call('chatStopListening'),
    /** Ek dosyasının adresi; ziyaretçi belirtecini taşır, yalnızca görsel bileşenine verin ve loglamayın. */
    attachmentUrl: async (attachmentId: string, download = false): Promise<string> =>
      (await this.bridge.call<{ url: string }>('chatAttachmentUrl', { attachmentId: requireString(attachmentId, 'attachmentId'), download })).url,
    /** Bu cihazın ziyaretçi kimliği (sohbet henüz kullanılmadıysa null). */
    getVisitorId: async (): Promise<string | null> =>
      (await this.bridge.call<{ visitorId: string | null }>('chatGetVisitorId')).visitorId ?? null,
    /** Sohbet olay dinleyicisi; kaldırma fonksiyonu döner. `open`: sohbet bildirimine tıklama. */
    addEventListener: <K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>): (() => void) => {
      const set = this.chatListeners[event] as Set<Listener<ChatEventMap[K]>> | undefined;
      if (!set) throw new TypeError(`Pushizo: bilinmeyen sohbet olayı '${String(event)}'.`);
      const remove = this.listen(set, listener);
      if (event === 'open') {
        const pending = this.pendingChatOpens.splice(0);
        pending.forEach((e) => safeInvoke(listener as Listener<ChatEventMap['open']>, e));
      }
      return remove;
    },
    removeEventListener: <K extends keyof ChatEventMap>(event: K, listener: Listener<ChatEventMap[K]>): void => {
      (this.chatListeners[event] as Set<Listener<ChatEventMap[K]>> | undefined)?.delete(listener);
    },
  };

  /** Native sohbet olayını türüne göre dağıtır. */
  private onChatEvent(raw: Record<string, unknown>): void {
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const emit = <K extends keyof ChatEventMap>(type: K, event: ChatEventMap[K]): void => {
      (this.chatListeners[type] as Set<Listener<ChatEventMap[K]>>).forEach((l) => safeInvoke(l, event));
    };
    switch (raw.type) {
      case 'message':
        emit('message', { message: raw.message as ChatMessage });
        break;
      case 'typing':
        emit('typing', { typing: raw.typing === true, name: str(raw.name) });
        break;
      case 'read':
        emit('read', { seq: num(raw.seq) });
        break;
      case 'unread':
        emit('unread', { count: num(raw.count) });
        break;
      case 'conversation':
        emit('conversation', { conversationId: str(raw.conversationId) ?? '', status: str(raw.status) ?? 'open', botActive: raw.botActive === true });
        break;
      case 'connection':
        emit('connection', { connected: raw.connected === true });
        break;
      case 'error':
        emit('error', { code: str(raw.code) ?? 'HS_ERROR', message: str(raw.message) });
        break;
      default:
        break;
    }
  }

  private onChatOpen(raw: Record<string, unknown>): void {
    const event: ChatEventMap['open'] = {
      conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : '',
      seq: typeof raw.seq === 'number' ? raw.seq : 0,
    };
    if (this.chatListeners.open.size === 0) {
      this.pendingChatOpens.push(event);
      return;
    }
    this.chatListeners.open.forEach((l) => safeInvoke(l, event));
  }

  // --- Konum (v2 Faz 17b) ---

  /**
   * Konum paylaşımı (yalnızca ön plan; arka plan konumu yok). Paylaşım açıkken native SDK konumu oturum başında ve
   * uygulama ön plana döndüğünde en sık 5 dakikada bir push aboneliğine yazar; izin yoksa veya gizlilik onayı
   * verilmemişse hiçbir şey gönderilmez. İlk konum sunucuda KVKK açık rıza kaydı sayılır; `setShared(false)` konumu ve
   * rıza kaydını sildirir. Tercih kalıcıdır. `initialize` öncesinde `setShared`/`requestPermission` `NOT_READY` ile
   * reddedilir (web: Web SDK hatası).
   */
  readonly Location = {
    /** Paylaşımı açar/kapatır (kalıcı). Açılırken izin varsa konum hemen gönderilir; izin için `requestPermission`. */
    setShared: (shared: boolean): Promise<void> => this.bridge.call('setLocationShared', { shared: Boolean(shared) }),
    /**
     * Paylaşım açık mı (kalıcı tercih; izin durumundan bağımsız). Native SDK'larda özelliktir (`isShared`); köprü
     * asenkron olduğundan burada Promise döndüren fonksiyondur.
     */
    isShared: async (): Promise<boolean> =>
      Boolean((await this.bridge.call<{ shared: boolean } | undefined>('isLocationShared'))?.shared),
    /**
     * Konum iznini ister (Android `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION`, iOS "kullanırken"). İzin yoksa önce
     * açıklama gösterilir (`rationale`; verilmezse SDK'nın yerelleştirilmiş metni), kullanıcı vazgeçerse sistem istemi
     * açılmaz. Sonuç: izin varsa veya verildiyse true; reddedildiyse, uygulama izni tanımlamadıysa veya vazgeçildiyse false.
     */
    requestPermission: async (rationale?: string): Promise<boolean> => {
      if (rationale !== undefined && rationale !== null && typeof rationale !== 'string') {
        throw new TypeError('Pushizo: rationale metin olmalı.');
      }
      const args: Record<string, unknown> = {};
      if (typeof rationale === 'string' && rationale.trim() !== '') args.rationale = rationale;
      return Boolean((await this.bridge.call<{ permission: boolean }>('requestLocationPermission', args)).permission);
    },
  };

  // --- Live Activities (iOS) ---

  /**
   * iOS Live Activities (ADR-0024; iOS 16.1+). Köprü genel `PushizoDefaultLiveActivityAttributes` türünü kullanır;
   * widget extension'da bu türle `ActivityConfiguration` tanımlanmalı ve sunucuda tür adı aynen kaydedilmelidir.
   * Android ve web `PLATFORM_NOT_SUPPORTED` koduyla reddeder.
   */
  readonly LiveActivities = {
    /**
     * Genel türü izlemeye alır: push-to-start belirteci (iOS 17.2+) ve başlayan her etkinliğin güncelleme belirteci
     * sunucuya kaydedilir. `initialize`'dan sonra, uygulama her açıldığında çağrılmalıdır.
     */
    setupDefaultLiveActivity: (): Promise<void> => this.bridge.call('setupDefaultLiveActivity'),
    /**
     * Genel türle yerel bir etkinlik başlatır (iOS 16.1+); sunucu sonraki `update`/`end` çağrılarını `activityId` ile
     * yapar. `attributes` içinde `pushizo` anahtarı ayrılmıştır.
     */
    startDefaultLiveActivity: (
      activityId: string,
      attributes: Record<string, LiveActivityValue>,
      contentState: Record<string, LiveActivityValue>,
    ): Promise<void> =>
      this.bridge.call('startDefaultLiveActivity', {
        activityId: liveActivityId(activityId),
        attributes: liveActivityValues(attributes, 'attributes', RESERVED_LIVE_ACTIVITY_KEY),
        contentState: liveActivityValues(contentState, 'contentState'),
      }),
  };

  // --- Hata ayıklama ---

  readonly Debug = {
    setLogLevel: (level: LogLevel): Promise<void> => {
      if (!LOG_LEVELS.includes(level)) throw new TypeError(`Pushizo: level ${LOG_LEVELS.join('|')} olmalı.`);
      return this.bridge.call('setLogLevel', { level });
    },
  };
}
