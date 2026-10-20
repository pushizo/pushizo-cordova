/** SDK günlük seviyesi (native `HsLog.Level` / `HSLog.Level`). */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';
/** `Pushizo.initialize` seçenekleri. */
export interface InitializeOptions {
    /** Dashboard'daki uygulama kimliği (`app_…`). */
    appId: string;
    /** API kökü; varsayılan `https://api.pushizo.com`. */
    apiUrl?: string;
    /** KVKK/GDPR: `setConsentGiven(true)` çağrılana kadar hiçbir ağ çağrısı yapılmaz. */
    requiresPrivacyConsent?: boolean;
    /** Varsayılan `warn`. */
    logLevel?: LogLevel;
}
/**
 * `Pushizo.login` kimlik kanıtı (ADR-0023 §9). App'in `identity_verification_mode` ayarına göre HMAC
 * `identityHash` ve/veya sunucunuzda imzalanmış ES256 `jwt` (`sub` = externalId, `aud` = appId) verilir.
 */
export interface LoginOptions {
    identityHash?: string;
    /** SDK isteklerinde `Authorization: Bearer` başlığıyla gider; süresi dolunca `updateUserJwt` ile yenilenir. */
    jwt?: string;
}
/** Bildirim içeriği (native `HsNotification` / `HSNotification`). */
export interface PushizoNotification {
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
    notification: PushizoNotification;
    result: {
        actionId: string | null;
        url: string | null;
    };
}
/** Uygulama ön plandayken gelen bildirim; dinleyici gösterimi engelleyebilir veya erteleyebilir. */
export interface ForegroundWillDisplayEvent {
    notification: PushizoNotification;
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
    message: {
        id: string;
    };
    result: {
        actionId: string;
        url: string | null;
    };
}
export type InAppLifecycleEventName = 'willDisplay' | 'didDisplay' | 'willDismiss' | 'didDismiss';
export interface InAppLifecycleEvent {
    event: InAppLifecycleEventName;
    message: {
        id: string;
    };
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
/** Tercih kanalı (ADR-0019 §4); tercihlerde `null` tüm kanallar demektir. */
export type PreferenceChannel = 'ios_push' | 'android_push' | 'web_push' | 'email' | 'sms';
/**
 * Kullanıcı tercihi: kategori × kanal → opt-in. `explicit` false ise değer kategori varsayılanından
 * türetilmiştir; `source` kaydı yazan taraftır (sdk, api, preference_center…).
 */
export interface UserPreference {
    category: string;
    /** null = tüm kanallar. */
    channel: PreferenceChannel | null;
    optedIn: boolean;
    explicit: boolean;
    source: string | null;
    /** Epoch milisaniye; türetilmiş değerde null. */
    updatedAt: number | null;
}
/** Mesaj kategorisi: çok dilli ad/açıklama (`dil kodu → metin`), kanal kısıtı (null = tümü) ve varsayılan opt-in. */
export interface PreferenceCategory {
    key: string;
    name: Record<string, string>;
    description: Record<string, string>;
    channels: string[] | null;
    defaultOptedIn: boolean;
}
/** `User.getPreferences` / `User.setPreferences` sonucu: kullanıcının tercihleri ve app'in kategorileri. */
export interface UserPreferences {
    preferences: UserPreference[];
    categories: PreferenceCategory[];
}
/** `User.setPreferences` girdisi; `channel` verilmezse veya null ise tüm kanallar. */
export interface PreferenceInput {
    category: string;
    optedIn: boolean;
    channel?: PreferenceChannel | null;
}
export type InAppTriggerValue = string | number | boolean;
/**
 * iOS Live Activity alan değeri (`PushizoDefaultLiveActivityAttributes.data` / `ContentState.data`): metin, sonlu
 * sayı veya mantıksal değer.
 */
export type LiveActivityValue = string | number | boolean;
/** Native katmanın gönderdiği ham ön plan olayı. */
export interface RawForegroundEvent {
    /** Erteleme kimliği; `displayNotification` ile kullanılır. */
    notificationId: string;
    /** true ise native gösterimi bekletiyor; JS karar vermeli (göster/engelle). */
    pending: boolean;
    notification: PushizoNotification;
}
export interface RawInAppLifecycleEvent {
    event: InAppLifecycleEventName;
    message: {
        id: string;
    };
}
export interface ChatAttachment {
    id: string;
    name: string;
    type: string;
    size: number;
}
export interface ChatQuickReply {
    id: string;
    label: string;
}
/** Sohbet mesajı; çevrimdışı kuyrukta bekleyen yerel mesajda `seq` 0 ve `status` `pending`. */
export interface ChatMessage {
    /** Sunucu kimliği; bekleyen yerel mesajda null. */
    id: string | null;
    seq: number;
    clientMessageId: string | null;
    sender: 'visitor' | 'agent' | 'bot' | 'system';
    authorName: string | null;
    text: string | null;
    attachments: ChatAttachment[];
    /** Bot sorusunun seçenekleri (yoksa null); seçim `Chat.sendMessage(label, { optionId })`. */
    quickReplies: ChatQuickReply[] | null;
    status: 'pending' | 'sent' | 'delivered' | 'read';
    /** Epoch milisaniye. */
    createdAt: number | null;
}
export interface ChatConversation {
    id: string;
    status: string;
    lastSeq: number;
    /** Temsilcinin okuduğu son sıra (ziyaretçi mesajlarında "okundu"). */
    agentLastReadSeq: number;
    visitorLastReadSeq: number;
    unreadCount: number;
    botActive: boolean;
    assigneeName: string | null;
    createdAt: number | null;
}
export interface ChatConversationState {
    conversation: ChatConversation | null;
    unreadCount: number;
}
export interface ChatMessagePage {
    messages: ChatMessage[];
    hasMore: boolean;
}
export interface ChatIdentifyResult {
    userId: string | null;
    conversation: ChatConversation | null;
}
export interface ChatConfig {
    enabled: boolean;
    /** Çalışma saatleri içinde ve en az bir temsilci (veya bot) çevrimiçi. */
    online: boolean;
    withinBusinessHours: boolean;
    color: string | null;
    textColor: string | null;
    position: string;
    theme: string;
    title: string | null;
    greeting: string | null;
    offlineMessage: string | null;
    collectEmailOffline: boolean;
    requireEmail: boolean;
    attachmentsEnabled: boolean;
    attachmentMaxBytes: number;
    attachmentTypes: string[];
    language: string;
}
export interface ChatStartOptions {
    name?: string;
    email?: string;
    language?: string;
}
export interface ChatMessagesOptions {
    /** Bu sıradan sonraki mesajlar (eksik tamamlama). */
    afterSeq?: number;
    /** Bu sıradan önceki mesajlar (geçmiş). */
    beforeSeq?: number;
    /** 1-100 (varsayılan 50). */
    limit?: number;
}
/** Ek kaynağı: base64 içerik veya dosya adresi (Android `content://`/`file://`, iOS `file://`). */
export type ChatAttachmentSource = {
    base64: string;
} | {
    uri: string;
};
export interface ChatAttachmentOptions {
    fileName: string;
    /** `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`, `text/plain`. */
    mimeType: string;
    text?: string;
}
/** Canlı sohbet olayları (tür → olay). */
export interface ChatEventMap {
    message: {
        message: ChatMessage;
    };
    typing: {
        typing: boolean;
        name: string | null;
    };
    /** Temsilci bu sıra numarasına kadar okudu. */
    read: {
        seq: number;
    };
    unread: {
        count: number;
    };
    conversation: {
        conversationId: string;
        status: string;
        botActive: boolean;
    };
    connection: {
        connected: boolean;
    };
    /** Kalıcı hata (ör. `HS_PLAN_FEATURE_REQUIRED`); dinleme durdu. */
    error: {
        code: string;
        message: string | null;
    };
    /** Sohbet bildirimine tıklandı: uygulama sohbet ekranını açmalı (soğuk başlatmada ilk dinleyiciye iletilir). */
    open: {
        conversationId: string;
        seq: number;
    };
}
