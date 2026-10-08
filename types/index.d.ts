// cordova-plugin-herosignal tip tanımları. Eklenti `window.HeroSignal` global'ini tanımlar.

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

/** Bildirim izni durumu; `provisional` yalnızca iOS içindir. */
export type PermissionStatus = 'granted' | 'denied' | 'default' | 'provisional';

/** Tag/trigger değeri; köprüye dizge olarak geçer. */
export type ScalarValue = string | number | boolean;

export interface InitializeOptions {
  /** API kökü; varsayılan `https://api.herosignal.dev`. */
  apiUrl?: string;
  /** KVKK/GDPR: `setConsentGiven(true)` çağrılana kadar ağ çağrısı yapılmaz. */
  requiresPrivacyConsent?: boolean;
  logLevel?: LogLevel;
}

/** Native hata: `code` örn. `INVALID_ARGUMENT`, `NOT_READY` veya API hata kodu. */
export interface HeroSignalError extends Error {
  code: string;
}

export interface NotificationAction {
  id: string;
  title: string;
  url: string | null;
}

export interface HeroSignalNotification {
  /** Tepsiden kaldırma kimliği: Android sistem bildirim kimliği, iOS teslimat kimliği. */
  notificationId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  deliveryId: string | null;
  messageId: string | null;
  groupKey: string | null;
  actions: NotificationAction[];
  data: Record<string, string>;
}

export interface NotificationClickEvent {
  notification: HeroSignalNotification;
  result: { actionId: string | null; url: string | null };
}

export interface ForegroundWillDisplayEvent {
  notification: HeroSignalNotification;
  /** Bildirimi göstermez; dinleyici içinde senkron çağrılmalıdır. */
  preventDefault(): void;
}

export interface PushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
}

export interface PushSubscriptionChangeEvent {
  current: PushSubscriptionState;
}

export interface InAppClickEvent {
  message: { id: string };
  result: { actionId: string; url: string | null };
}

export interface InAppLifecycleEvent {
  message: { id: string };
}

export interface InAppLifecycleListener {
  willDisplay?: (event: InAppLifecycleEvent) => void;
  didDisplay?: (event: InAppLifecycleEvent) => void;
  willDismiss?: (event: InAppLifecycleEvent) => void;
  didDismiss?: (event: InAppLifecycleEvent) => void;
}

/** Bildirim kutusu öğesi; zamanlar ISO-8601 dizgesidir. */
export interface InboxItem {
  id: string;
  messageId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  data: Record<string, string>;
  read: boolean;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InboxListOptions {
  /** 1-200 (varsayılan 50). */
  limit?: number;
  cursor?: string;
}

export interface HeroSignalPushSubscription {
  getId(): Promise<string | null>;
  getToken(): Promise<string | null>;
  getOptedIn(): Promise<boolean>;
  getState(): Promise<PushSubscriptionState>;
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  addObserver(cb: (event: PushSubscriptionChangeEvent) => void): void;
  removeObserver(cb: (event: PushSubscriptionChangeEvent) => void): void;
}

export interface HeroSignalUser {
  addTag(key: string, value: ScalarValue): Promise<void>;
  addTags(tags: Record<string, ScalarValue>): Promise<void>;
  removeTag(key: string): Promise<void>;
  removeTags(keys: string[]): Promise<void>;
  getTags(): Promise<Record<string, string>>;
  addAlias(label: string, id: string): Promise<void>;
  addAliases(aliases: Record<string, string>): Promise<void>;
  removeAlias(label: string): Promise<void>;
  setLanguage(code: string): Promise<void>;
  addEmail(email: string): Promise<void>;
  removeEmail(email: string): Promise<void>;
  addSms(phoneNumber: string): Promise<void>;
  removeSms(phoneNumber: string): Promise<void>;
  getExternalId(): Promise<string | null>;
  /** HeroSignal kullanıcı kimliği (`user_id`). */
  getId(): Promise<string | null>;
  pushSubscription: HeroSignalPushSubscription;
}

export interface HeroSignalNotifications {
  getPermission(): Promise<boolean>;
  getPermissionStatus(): Promise<PermissionStatus>;
  requestPermission(): Promise<boolean>;
  addClickListener(cb: (event: NotificationClickEvent) => void): void;
  removeClickListener(cb: (event: NotificationClickEvent) => void): void;
  addForegroundLifecycleListener(cb: (event: ForegroundWillDisplayEvent) => void): void;
  removeForegroundLifecycleListener(cb: (event: ForegroundWillDisplayEvent) => void): void;
  clearAll(): Promise<void>;
  /** Android: tam sayı sistem bildirim kimliği; iOS: dizge kimlik (`notification.notificationId`). */
  removeNotification(id: number | string): Promise<void>;
  removeGroupedNotifications(group: string): Promise<void>;
}

export interface HeroSignalSession {
  sendEvent(name: string, properties?: Record<string, unknown>, value?: number): Promise<void>;
}

export interface HeroSignalInAppMessages {
  addTrigger(key: string, value: ScalarValue): Promise<void>;
  addTriggers(triggers: Record<string, ScalarValue>): Promise<void>;
  removeTrigger(key: string): Promise<void>;
  removeTriggers(keys: string[]): Promise<void>;
  clearTriggers(): Promise<void>;
  getTriggers(): Promise<Record<string, string>>;
  setScreen(name: string | null): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  getPaused(): Promise<boolean>;
  addClickListener(cb: (event: InAppClickEvent) => void): void;
  removeClickListener(cb: (event: InAppClickEvent) => void): void;
  addLifecycleListener(listener: InAppLifecycleListener): void;
  removeLifecycleListener(listener: InAppLifecycleListener): void;
}

export interface HeroSignalInbox {
  list(options?: InboxListOptions): Promise<InboxPage>;
  markRead(id: string): Promise<InboxItem>;
  markAllRead(): Promise<number>;
  delete(id: string): Promise<void>;
  unreadCount(): Promise<number>;
}

export interface HeroSignalStatic {
  initialize(appId: string, options?: InitializeOptions): Promise<void>;
  setConsentGiven(given: boolean): Promise<void>;
  login(externalId: string, identityHash?: string): Promise<void>;
  logout(): Promise<void>;
  User: HeroSignalUser;
  Notifications: HeroSignalNotifications;
  Session: HeroSignalSession;
  InAppMessages: HeroSignalInAppMessages;
  Inbox: HeroSignalInbox;
  Debug: { setLogLevel(level: LogLevel): Promise<void> };
}

declare global {
  interface Window {
    HeroSignal: HeroSignalStatic;
  }
  var HeroSignal: HeroSignalStatic;
}

declare const HeroSignalPlugin: HeroSignalStatic;
export default HeroSignalPlugin;
