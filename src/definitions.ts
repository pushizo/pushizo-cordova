/** SDK günlük seviyesi (native `HsLog.Level` / `HSLog.Level`). */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

/** `HeroSignal.initialize` seçenekleri. */
export interface InitializeOptions {
  /** Dashboard'daki uygulama kimliği (`app_…`). */
  appId: string;
  /** API kökü; varsayılan `https://api.herosignal.dev`. */
  apiUrl?: string;
  /** KVKK/GDPR: `setConsentGiven(true)` çağrılana kadar hiçbir ağ çağrısı yapılmaz. */
  requiresPrivacyConsent?: boolean;
  /** Varsayılan `warn`. */
  logLevel?: LogLevel;
}

/** Bildirim içeriği (native `HsNotification` / `HSNotification`). */
export interface HeroSignalNotification {
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  deliveryId: string | null;
  messageId: string | null;
  data: Record<string, string>;
  /** Yalnızca Android: tepsi kimliği (`Notifications.removeNotification` için); iOS'ta null. */
  androidNotificationId: number | null;
}

/** Bildirim tıklaması: `result.actionId` düğme kimliği (gövde tıklamasında null). */
export interface NotificationClickEvent {
  notification: HeroSignalNotification;
  result: { actionId: string | null; url: string | null };
}

/** Uygulama ön plandayken gelen bildirim; dinleyici gösterimi engelleyebilir veya erteleyebilir. */
export interface ForegroundWillDisplayEvent {
  notification: HeroSignalNotification;
  /** Bildirimin şimdi gösterilmesini engeller; daha sonra `display()` ile gösterilebilir. */
  preventDefault(): void;
  /** Engellenmiş bildirimi gösterir (iOS'ta olaydan sonra en fazla 25 sn içinde). */
  display(): Promise<void>;
  readonly prevented: boolean;
}

/** Push aboneliği durumu. */
export interface PushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
  permission: boolean;
}

export interface PermissionChangeEvent {
  permission: boolean;
}

export interface InAppClickEvent {
  message: { id: string };
  result: { actionId: string; url: string | null };
}

export type InAppLifecycleEventName = 'willDisplay' | 'didDisplay' | 'willDismiss' | 'didDismiss';

export interface InAppLifecycleEvent {
  event: InAppLifecycleEventName;
  message: { id: string };
}

/** In-app yaşam döngüsü dinleyicisi; yalnızca ilgilenilen alanlar verilir. */
export interface InAppLifecycleListener {
  willDisplay?: (event: InAppLifecycleEvent) => void;
  didDisplay?: (event: InAppLifecycleEvent) => void;
  willDismiss?: (event: InAppLifecycleEvent) => void;
  didDismiss?: (event: InAppLifecycleEvent) => void;
}

/** Bildirim kutusu öğesi; zamanlar epoch milisaniyedir. */
export interface InboxItem {
  id: string;
  messageId: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  imageUrl: string | null;
  data: Record<string, string>;
  read: boolean;
  readAt: number | null;
  archivedAt: number | null;
  expiresAt: number | null;
  createdAt: number | null;
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

export type InAppTriggerValue = string | number | boolean;

/** Native katmanın gönderdiği ham ön plan olayı. */
export interface RawForegroundEvent {
  /** Erteleme kimliği; `displayNotification` ile kullanılır. */
  notificationId: string;
  /** true ise native gösterimi bekletiyor; JS karar vermeli (göster/engelle). */
  pending: boolean;
  notification: HeroSignalNotification;
}

export interface RawInAppLifecycleEvent {
  event: InAppLifecycleEventName;
  message: { id: string };
}
