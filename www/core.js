"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushizoCore = void 0;
exports.normalizeNotification = normalizeNotification;
const LOG_LEVELS = ['none', 'error', 'warn', 'info', 'debug'];
const LIFECYCLE_EVENTS = ['willDisplay', 'didDisplay', 'willDismiss', 'didDismiss'];
/** Dinleyici hatası diğer dinleyicileri ve native köprüyü etkilemez. */
function safeInvoke(listener, event) {
    try {
        listener(event);
    }
    catch (err) {
        console.error('[Pushizo] dinleyici hatası', err);
    }
}
function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`Pushizo: ${name} boş olmayan bir metin olmalı.`);
    }
    return value;
}
function stringRecord(input, name) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError(`Pushizo: ${name} bir nesne olmalı.`);
    }
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new TypeError(`Pushizo: ${name}.${key} metin, sayı veya boolean olmalı.`);
        }
        out[key] = String(value);
    }
    return out;
}
const CHAT_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];
/** Sohbet metni: boş olmayan, en çok 4000 karakter (sunucu kuralı). */
function chatText(value) {
    const text = requireString(value, 'text');
    if (text.trim().length > 4000)
        throw new RangeError('Pushizo: mesaj en fazla 4000 karakter olabilir.');
    return text;
}
function chatSeq(value, name, min) {
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
function liveActivityId(value) {
    if (typeof value !== 'string' || !LIVE_ACTIVITY_ID.test(value)) {
        throw new TypeError('Pushizo: activityId 1-100 karakter olmalı (harf, rakam ve _ . : -).');
    }
    return value;
}
/** Düz nesne; anahtar 1-64 karakter, değer metin / sonlu sayı / boolean (native SDK ile aynı kurallar). */
function liveActivityValues(input, name, reservedKey) {
    const proto = input !== null && typeof input === 'object' ? Object.getPrototypeOf(input) : undefined;
    if (Array.isArray(input) || (proto !== Object.prototype && proto !== null)) {
        throw new TypeError(`Pushizo: ${name} düz bir nesne olmalı.`);
    }
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (key.length < 1 || key.length > MAX_LIVE_ACTIVITY_KEY_LENGTH) {
            throw new TypeError(`Pushizo: ${name} anahtarları 1-${MAX_LIVE_ACTIVITY_KEY_LENGTH} karakter olmalı.`);
        }
        if (key === reservedKey)
            throw new TypeError(`Pushizo: ${name} içinde '${reservedKey}' anahtarı ayrılmıştır.`);
        if (typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
            throw new TypeError(`Pushizo: ${name}.${key} metin, sonlu sayı veya boolean olmalı.`);
        }
        out[key] = value;
    }
    return out;
}
/** Yerleşim anahtarı: native SDK ve sunucu kuralı. */
const PLACEMENT_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;
/** Rapor çağrılarında yalnızca mesaj kimliği köprüye gider; native katman mesajı son `list` yanıtlarından bulur. */
function placementMessageId(message) {
    if (message === null || typeof message !== 'object')
        throw new TypeError('Pushizo: message bir nesne olmalı.');
    return requireString(message.id, 'message.id');
}
const PREFERENCE_CHANNELS = ['ios_push', 'android_push', 'web_push', 'email', 'sms'];
/** `setPreferences` girdisini yerel SDK kurallarıyla doğrular: 1-100 kayıt, kategori 1-64 karakter, bilinen kanal. */
function preferenceArgs(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
        throw new RangeError('Pushizo: preferences 1-100 kayıt olmalı.');
    }
    return input.map((p, i) => {
        var _a;
        if (p === null || typeof p !== 'object')
            throw new TypeError(`Pushizo: preferences[${i}] bir nesne olmalı.`);
        const category = requireString(p.category, `preferences[${i}].category`).trim();
        if (category.length > 64)
            throw new RangeError(`Pushizo: preferences[${i}].category en fazla 64 karakter olmalı.`);
        const channel = (_a = p.channel) !== null && _a !== void 0 ? _a : null;
        if (channel !== null && !PREFERENCE_CHANNELS.includes(channel)) {
            throw new TypeError(`Pushizo: preferences[${i}].channel ${PREFERENCE_CHANNELS.join('|')} veya null olmalı.`);
        }
        if (typeof p.optedIn !== 'boolean')
            throw new TypeError(`Pushizo: preferences[${i}].optedIn boolean olmalı.`);
        return { category, channel, optedIn: p.optedIn };
    });
}
/** `login` profilini doğrular; etiket değerleri metne çevrilir, boş alanlar köprüye gönderilmez. */
function profileArgs(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Pushizo: profile bir nesne olmalı.');
    }
    const out = {};
    if (input.email !== undefined && input.email !== null)
        out.email = requireString(input.email, 'profile.email');
    if (input.sms !== undefined && input.sms !== null)
        out.sms = requireString(input.sms, 'profile.sms');
    if (input.tags !== undefined && input.tags !== null) {
        const tags = stringRecord(input.tags, 'profile.tags');
        if (Object.keys(tags).length > 0)
            out.tags = tags;
    }
    if (input.aliases !== undefined && input.aliases !== null) {
        const aliases = stringRecord(input.aliases, 'profile.aliases');
        if (Object.keys(aliases).length > 0)
            out.aliases = aliases;
    }
    return out;
}
/** Native rıza listesini eksik alanlara karşı normalize eder (`updatedAt` epoch milisaniye). */
function normalizeConsents(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (item === null || typeof item !== 'object')
            continue;
        const c = item;
        if (typeof c.purpose !== 'string' || c.purpose === '')
            continue;
        out.push({
            purpose: c.purpose,
            granted: c.granted === true,
            source: typeof c.source === 'string' ? c.source : null,
            updatedAt: typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) ? c.updatedAt : null,
        });
    }
    return out;
}
function textMap(value) {
    const out = {};
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return out;
    for (const [key, text] of Object.entries(value))
        if (typeof text === 'string')
            out[key] = text;
    return out;
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}
/** Native tercih yanıtını eksik alanlara karşı normalize eder (zamanlar epoch milisaniye). */
const DELIVERY_SETTINGS = ['auto', 'notifications', 'auto_start', 'battery_optimization', 'app_details'];
function deliverySetting(value) {
    if (value === undefined || value === null)
        return 'auto';
    if (!DELIVERY_SETTINGS.includes(value)) {
        throw new TypeError(`Pushizo: setting ${DELIVERY_SETTINGS.join('|')} olmalı.`);
    }
    return value;
}
/** Native teslim durumu; `supported` true değilse (iOS, web, başlatılmamış SDK) "desteklenmiyor / risk yok" durumu. */
function normalizeDeliveryStatus(raw) {
    const m = raw !== null && raw !== void 0 ? raw : {};
    const supported = m.supported === true;
    const text = (value, fallback) => (supported && typeof value === 'string' ? value : fallback);
    // Native SDK'nın ileride ekleyeceği, bu sürümün tanımadığı ekran atlanır.
    const recommendedSettings = supported
        ? stringArray(m.recommendedSettings).filter((s) => s !== 'auto' && DELIVERY_SETTINGS.includes(s))
        : [];
    return {
        supported,
        manufacturer: text(m.manufacturer, ''),
        brand: text(m.brand, ''),
        vendor: text(m.vendor, 'other'),
        aggressiveVendor: supported && m.aggressiveVendor === true,
        rom: text(m.rom, ''),
        romVersion: supported && typeof m.romVersion === 'string' ? m.romVersion : null,
        notificationsEnabled: !supported || m.notificationsEnabled !== false,
        channelBlocked: supported && m.channelBlocked === true,
        batteryOptimizationExempt: !supported || m.batteryOptimizationExempt !== false,
        backgroundRestricted: supported && m.backgroundRestricted === true,
        standbyBucket: supported && typeof m.standbyBucket === 'string' ? m.standbyBucket : null,
        powerSaveMode: supported && m.powerSaveMode === true,
        dataSaverEnabled: supported && m.dataSaverEnabled === true,
        restricted: supported && m.restricted === true,
        risk: supported && (m.risk === 'high' || m.risk === 'elevated') ? m.risk : 'none',
        recommendedSettings,
    };
}
function normalizePreferences(raw) {
    const preferences = Array.isArray(raw === null || raw === void 0 ? void 0 : raw.preferences) ? raw.preferences : [];
    const categories = Array.isArray(raw === null || raw === void 0 ? void 0 : raw.categories) ? raw.categories : [];
    return {
        preferences: preferences.map((p) => {
            var _a, _b;
            return ({
                category: p.category,
                channel: (_a = p.channel) !== null && _a !== void 0 ? _a : null,
                optedIn: p.optedIn === true,
                explicit: p.explicit === true,
                source: (_b = p.source) !== null && _b !== void 0 ? _b : null,
                updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : null,
            });
        }),
        categories: categories.map((c) => ({
            key: c.key,
            name: textMap(c.name),
            description: textMap(c.description),
            channels: Array.isArray(c.channels) ? c.channels.filter((x) => typeof x === 'string') : null,
            defaultOptedIn: c.defaultOptedIn !== false,
        })),
    };
}
/** Native bildirim nesnesini eksik alanlara karşı normalize eder. */
function normalizeNotification(raw) {
    var _a, _b, _c, _d, _e, _f, _g;
    const n = raw !== null && raw !== void 0 ? raw : {};
    return {
        title: (_a = n.title) !== null && _a !== void 0 ? _a : null,
        body: (_b = n.body) !== null && _b !== void 0 ? _b : null,
        url: (_c = n.url) !== null && _c !== void 0 ? _c : null,
        imageUrl: (_d = n.imageUrl) !== null && _d !== void 0 ? _d : null,
        deliveryId: (_e = n.deliveryId) !== null && _e !== void 0 ? _e : null,
        messageId: (_f = n.messageId) !== null && _f !== void 0 ? _f : null,
        data: (_g = n.data) !== null && _g !== void 0 ? _g : {},
        androidNotificationId: typeof n.androidNotificationId === 'number' ? n.androidNotificationId : null,
    };
}
/** Uygulamaların kullandığı Pushizo cephesi. */
class PushizoCore {
    constructor(bridge) {
        this.bridge = bridge;
        this.subscribed = false;
        this.subscribing = null;
        this.clickListeners = new Set();
        this.foregroundListeners = new Set();
        this.subscriptionObservers = new Set();
        this.permissionObservers = new Set();
        this.inAppClickListeners = new Set();
        this.inAppLifecycleListeners = new Set();
        /** Dinleyici yokken gelen tıklamalar (soğuk başlatma); ilk dinleyiciye teslim edilir. */
        this.pendingClicks = [];
        /** Canlı sohbet dinleyicileri (tür başına). */
        this.chatListeners = {
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
        this.pendingChatOpens = [];
        this.foregroundFlag = false;
        /** Native SDK başlatıldı mı (`initialize` tamamlandı ya da süreç saklanan yapılandırmayla erkenden başlatıldı). */
        this.isInitialized = async () => { var _a; return Boolean((_a = (await this.bridge.call('isInitialized'))) === null || _a === void 0 ? void 0 : _a.initialized); };
        // --- Kullanıcı ---
        this.User = {
            addTag: (key, value) => this.bridge.call('addTags', { tags: stringRecord({ [requireString(key, 'key')]: value }, 'tags') }),
            addTags: (tags) => this.bridge.call('addTags', { tags: stringRecord(tags, 'tags') }),
            removeTag: (key) => this.bridge.call('removeTags', { keys: [requireString(key, 'key')] }),
            removeTags: (keys) => this.bridge.call('removeTags', { keys: keys.map((k) => requireString(k, 'key')) }),
            getTags: async () => { var _a; return (_a = (await this.bridge.call('getTags')).tags) !== null && _a !== void 0 ? _a : {}; },
            setLanguage: (code) => this.bridge.call('setLanguage', { code: requireString(code, 'code') }),
            addAlias: (label, id) => this.bridge.call('addAliases', { aliases: { [requireString(label, 'label')]: requireString(id, 'id') } }),
            addAliases: (aliases) => this.bridge.call('addAliases', { aliases: stringRecord(aliases, 'aliases') }),
            removeAlias: (label) => this.bridge.call('removeAlias', { label: requireString(label, 'label') }),
            addEmail: (email) => this.bridge.call('addEmail', { email: requireString(email, 'email') }),
            removeEmail: (email) => this.bridge.call('removeEmail', { email: requireString(email, 'email') }),
            addSms: (phoneNumber) => this.bridge.call('addSms', { phoneNumber: requireString(phoneNumber, 'phoneNumber') }),
            removeSms: (phoneNumber) => this.bridge.call('removeSms', { phoneNumber: requireString(phoneNumber, 'phoneNumber') }),
            getExternalId: async () => { var _a; return (_a = (await this.bridge.call('getUser')).externalId) !== null && _a !== void 0 ? _a : null; },
            getId: async () => { var _a; return (_a = (await this.bridge.call('getUser')).id) !== null && _a !== void 0 ? _a : null; },
            /** Bu cihazda `addEmail` ile kaydedilmiş e-posta adresleri (yerel kayıt; sunucu sorgulanmaz). */
            getEmails: async () => { var _a; return stringArray((_a = (await this.bridge.call('getContacts'))) === null || _a === void 0 ? void 0 : _a.emails); },
            /** Bu cihazda `addSms` ile kaydedilmiş SMS numaraları (E.164; yerel kayıt). */
            getSmsNumbers: async () => { var _a; return stringArray((_a = (await this.bridge.call('getContacts'))) === null || _a === void 0 ? void 0 : _a.smsNumbers); },
            /**
             * Kullanıcının kategori/kanal tercihleri ve app kategorileri (ADR-0019 §4); sahiplik kanıtı yerel SDK'da eklenir.
             * Abonelik henüz yoksa `NOT_READY` koduyla reddedilir.
             */
            getPreferences: async () => normalizePreferences(await this.bridge.call('getPreferences')),
            /** Tercihleri yazar (1-100 kayıt; `channel` verilmezse tüm kanallar); güncel listeyi döndürür. */
            setPreferences: async (preferences) => normalizePreferences(await this.bridge.call('setPreferences', { preferences: preferenceArgs(preferences) })),
            /**
             * Reklam kişiselleştirme rızası (ADR-0037): `true` iken kullanıcının e-posta/telefon özeti app'in bağladığı reklam
             * platformu kitlelerine gönderilebilir; `false` rızayı geri alır. Güncel tercih listesini döndürür.
             */
            setAdsPersonalizationConsent: async (granted) => {
                if (typeof granted !== 'boolean')
                    throw new TypeError('Pushizo: granted boolean olmalı.');
                return normalizePreferences(await this.bridge.call('setAdsPersonalizationConsent', { granted }));
            },
            /** Rıza kayıtları (`ads_personalization` …). Abonelik henüz yoksa `NOT_READY` koduyla reddedilir. */
            getConsents: async () => { var _a; return normalizeConsents((_a = (await this.bridge.call('getConsents'))) === null || _a === void 0 ? void 0 : _a.consents); },
            /**
             * Fire OS ADM kayıt kimliği (yalnızca Android; ana FCM aboneliğinin yerine geçmez). ADM kaydını kendisi yapan
             * uygulamalar içindir. iOS ve web'de etkisizdir.
             */
            registerAdm: (token) => this.bridge.call('registerAdm', { token: requireString(token, 'token') }),
            pushSubscription: {
                getState: () => this.bridge.call('getPushSubscription'),
                getId: async () => { var _a; return (_a = (await this.bridge.call('getPushSubscription')).id) !== null && _a !== void 0 ? _a : null; },
                getToken: async () => { var _a; return (_a = (await this.bridge.call('getPushSubscription')).token) !== null && _a !== void 0 ? _a : null; },
                getOptedIn: async () => Boolean((await this.bridge.call('getPushSubscription')).optedIn),
                optIn: () => this.bridge.call('optIn'),
                optOut: () => this.bridge.call('optOut'),
                /** Token/abonelik/izin değişimi; dönen fonksiyon aboneliği kaldırır. */
                addObserver: (cb) => this.listen(this.subscriptionObservers, cb),
                removeObserver: (cb) => {
                    this.subscriptionObservers.delete(cb);
                },
            },
        };
        // --- Bildirimler ---
        this.Notifications = {
            /** Sistem bildirim izni (Android 13+ POST_NOTIFICATIONS, iOS UNAuthorization). */
            getPermission: async () => Boolean((await this.bridge.call('getPermission')).permission),
            /** İzin ister; sonuç izin durumudur. */
            requestPermission: async () => Boolean((await this.bridge.call('requestPermission')).permission),
            /** Tepsideki/bildirim merkezindeki tüm Pushizo bildirimlerini kaldırır ve rozeti sıfırlar. */
            clearAll: () => this.bridge.call('clearAll'),
            /**
             * Tek bildirimi kaldırır. Android: `notification.androidNotificationId` (tamsayı). iOS: bildirim isteği kimliği
             * (`UNNotificationRequest.identifier`, metin; tamsayı verilirse metne çevrilir). Web'de `UNAVAILABLE`.
             */
            removeNotification: (id) => {
                if (typeof id === 'string')
                    return this.bridge.call('removeNotification', { identifier: requireString(id, 'identifier') });
                if (!Number.isInteger(id))
                    throw new TypeError('Pushizo: androidNotificationId tamsayı olmalı.');
                return this.bridge.call('removeNotification', { id });
            },
            /** Aynı gruptaki bildirimleri kaldırır (Android `android_group`, iOS `thread-id`). */
            removeGroupedNotifications: (group) => this.bridge.call('removeGroupedNotifications', { group: requireString(group, 'group') }),
            /**
             * Uygulama rozetini ayarlar (yalnızca iOS; bildirim uzantısıyla paylaşılan sayaç da eşitlenir). Android'de rozet
             * görünen bildirimlerden hesaplandığından ve web'de karşılığı olmadığından etkisizdir.
             */
            setBadgeCount: (count) => {
                if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
                    throw new RangeError('Pushizo: count negatif olmayan tam sayı olmalı.');
                }
                return this.bridge.call('setBadgeCount', { count });
            },
            /** Rozeti sıfırlar (yalnızca iOS; Android ve web'de etkisiz). */
            clearBadge: () => this.bridge.call('setBadgeCount', { count: 0 }),
            /** Bildirim/düğme tıklaması; soğuk başlatmada bekleyen tıklama ilk dinleyiciye teslim edilir. */
            addClickListener: (cb) => {
                const remove = this.listen(this.clickListeners, cb);
                const pending = this.pendingClicks.splice(0);
                pending.forEach((e) => safeInvoke(cb, e));
                return remove;
            },
            removeClickListener: (cb) => {
                this.clickListeners.delete(cb);
            },
            /** Ön planda gelen bildirim; `event.preventDefault()` gösterimi engeller, `event.display()` gösterir. */
            addForegroundLifecycleListener: (cb) => {
                const remove = this.listen(this.foregroundListeners, cb);
                this.syncForegroundFlag();
                return () => {
                    remove();
                    this.syncForegroundFlag();
                };
            },
            removeForegroundLifecycleListener: (cb) => {
                this.foregroundListeners.delete(cb);
                this.syncForegroundFlag();
            },
            /** İzin değişimi (istem sonucu veya kullanıcının sistem ayarlarından değiştirmesi). */
            addPermissionObserver: (cb) => this.listen(this.permissionObservers, cb),
            removePermissionObserver: (cb) => {
                this.permissionObservers.delete(cb);
            },
        };
        // --- Oturum / olaylar ---
        this.Session = {
            /** Özel olay / outcome; in-app olay tetiklerini de değerlendirir. */
            sendEvent: (name, properties, value) => {
                const args = { name: requireString(name, 'name'), properties: properties !== null && properties !== void 0 ? properties : {} };
                if (value !== undefined && value !== null) {
                    if (typeof value !== 'number' || !Number.isFinite(value))
                        throw new TypeError('Pushizo: value sayı olmalı.');
                    args.value = value;
                }
                return this.bridge.call('sendEvent', args);
            },
        };
        // --- In-app mesajlar ---
        this.InAppMessages = {
            addTrigger: (key, value) => this.bridge.call('addTriggers', { triggers: stringRecord({ [requireString(key, 'key')]: value }, 'triggers') }),
            addTriggers: (triggers) => this.bridge.call('addTriggers', { triggers: stringRecord(triggers, 'triggers') }),
            removeTrigger: (key) => this.bridge.call('removeTriggers', { keys: [requireString(key, 'key')] }),
            removeTriggers: (keys) => this.bridge.call('removeTriggers', { keys: keys.map((k) => requireString(k, 'key')) }),
            clearTriggers: () => this.bridge.call('clearTriggers'),
            getTriggers: async () => { var _a; return (_a = (await this.bridge.call('getTriggers')).triggers) !== null && _a !== void 0 ? _a : {}; },
            /** Geçerli ekran adı (`screen` tetikleri); ekrandan çıkarken `null`. */
            setScreen: (name) => this.bridge.call('setScreen', { name: name || null }),
            /** true iken yeni mesaj gösterilmez (tetikler kaydedilmeye devam eder). */
            setPaused: (paused) => this.bridge.call('setInAppPaused', { paused: Boolean(paused) }),
            getPaused: async () => Boolean((await this.bridge.call('getInAppPaused')).paused),
            addClickListener: (cb) => this.listen(this.inAppClickListeners, cb),
            removeClickListener: (cb) => {
                this.inAppClickListeners.delete(cb);
            },
            addLifecycleListener: (listener) => this.listen(this.inAppLifecycleListeners, listener),
            removeLifecycleListener: (listener) => {
                this.inAppLifecycleListeners.delete(listener);
            },
        };
        // --- Bildirim kutusu ---
        this.Inbox = {
            /** Öğeler (yeniden eskiye), okunmamış sayısı ve sonraki sayfa imleci. */
            list: (options = {}) => {
                var _a;
                const limit = (_a = options.limit) !== null && _a !== void 0 ? _a : 50;
                if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
                    return Promise.reject(new RangeError('Pushizo: limit 1-200 olmalı.'));
                }
                const args = { limit };
                if (options.cursor)
                    args.cursor = options.cursor;
                return this.bridge.call('inboxList', args);
            },
            markRead: (id) => this.bridge.call('inboxMarkRead', { id: requireString(id, 'id') }),
            /** Tümünü okundu işaretler; kalan okunmamış sayısını döndürür. */
            markAllRead: async () => { var _a; return (_a = (await this.bridge.call('inboxMarkAllRead')).unreadCount) !== null && _a !== void 0 ? _a : 0; },
            /** Öğeyi kutudan kaldırır (sunucuda arşivlenir). */
            archive: (id) => this.bridge.call('inboxArchive', { id: requireString(id, 'id') }),
            unreadCount: async () => { var _a; return (_a = (await this.bridge.call('inboxUnreadCount')).unreadCount) !== null && _a !== void 0 ? _a : 0; },
        };
        // --- İçerik kartları (ADR-0082) ---
        this.ContentCards = {
            /** Kart akışı (sabitlenmiş → öncelik → yeni) ve görülmemiş kart sayısı; `limit` 1-100 (varsayılan 50). */
            list: (limit = 50) => {
                if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
                    return Promise.reject(new RangeError('Pushizo: limit 1-100 olmalı.'));
                }
                return this.bridge.call('contentCardsList', { limit });
            },
            /** Kart ekranda gösterildi (ilk gösterim kaydedilir). */
            logImpression: (id) => this.cardEvent(id, 'impression'),
            /** Karta tıklandı (gösterim de sayılır). */
            logClick: (id) => this.cardEvent(id, 'click'),
            /** Kart kapatıldı; akıştan kalkar. */
            dismiss: (id) => this.cardEvent(id, 'dismiss'),
        };
        // --- Canlı sohbet (ADR-0040) ---
        /**
         * Canlı sohbet (Android ve iOS): ziyaretçi kimliği, çevrimdışı kuyruk, canlı akış (SSE + yoklama yedeği) ve push ile
         * gelen mesajlar native SDK'dadır; login/logout ve push aboneliği değişince bağlama native SDK'da yenilenir.
         */
        this.Chat = {
            /** Sohbeti etkinleştirir ve ziyaretçiyi bağlar (giriş yapmış kullanıcı, push aboneliği); konuşma varsa döner. */
            start: (options = {}) => {
                const args = {};
                if (options.name)
                    args.name = options.name;
                if (options.email)
                    args.email = options.email;
                if (options.language)
                    args.language = options.language;
                return this.bridge.call('chatStart', args);
            },
            /** Widget ayarları, çevrimiçi durumu, çevrimdışı metni ve ek sınırları. */
            getConfig: (language) => this.bridge.call('chatGetConfig', language ? { language } : {}),
            /** Konuşma (yoksa null) ve okunmamış sayısı. */
            getConversation: () => this.bridge.call('chatGetConversation'),
            /** Mesajlar (kronolojik): parametresiz en yeni `limit`; `afterSeq` sonrakiler, `beforeSeq` daha eski geçmiş. */
            getMessages: (options = {}) => {
                var _a;
                const limit = (_a = options.limit) !== null && _a !== void 0 ? _a : 50;
                if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
                    return Promise.reject(new RangeError('Pushizo: limit 1-100 olmalı.'));
                }
                const args = { limit };
                try {
                    if (options.afterSeq !== undefined)
                        args.afterSeq = chatSeq(options.afterSeq, 'afterSeq', 0);
                    if (options.beforeSeq !== undefined)
                        args.beforeSeq = chatSeq(options.beforeSeq, 'beforeSeq', 1);
                }
                catch (err) {
                    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
                }
                return this.bridge.call('chatGetMessages', args);
            },
            /**
             * Mesaj gönderir (ilk mesaj konuşmayı açar); `optionId` bot sorusunda seçilen hızlı yanıttır. Ağ yoksa mesaj native
             * kuyruğa alınır ve `pending` mesaj döner; gönderilince `message` olayıyla sunucu kopyası gelir.
             */
            sendMessage: (text, options = {}) => {
                const args = { text: chatText(text) };
                if (options.optionId)
                    args.optionId = options.optionId;
                return this.bridge.call('chatSendMessage', args);
            },
            /** Ek gönderir (PNG/JPEG/WebP/GIF/PDF/düz metin, en çok 10 MB). */
            sendAttachment: (source, options) => {
                const mime = requireString(options.mimeType, 'mimeType').split(';')[0].trim().toLowerCase();
                if (!CHAT_ATTACHMENT_TYPES.includes(mime)) {
                    return Promise.reject(new TypeError(`Pushizo: desteklenmeyen dosya türü '${mime}'.`));
                }
                const args = { fileName: requireString(options.fileName, 'fileName'), mimeType: mime };
                if ('base64' in source)
                    args.base64 = requireString(source.base64, 'base64');
                else
                    args.uri = requireString(source.uri, 'uri');
                if (options.text && options.text.trim())
                    args.text = options.text;
                return this.bridge.call('chatSendAttachment', args);
            },
            /** `seq` numarasına kadar okundu işaretler; kalan okunmamış sayısını döndürür. */
            markRead: async (seq) => { var _a; return (_a = (await this.bridge.call('chatMarkRead', { seq: chatSeq(seq, 'seq', 0) })).unreadCount) !== null && _a !== void 0 ? _a : 0; },
            /** Okunmamış sayısını sunucudan yeniler. */
            refreshUnreadCount: async () => { var _a; return (_a = (await this.bridge.call('chatRefreshUnreadCount')).unreadCount) !== null && _a !== void 0 ? _a : 0; },
            /** Son bilinen okunmamış sayısı (ağ çağrısı yok). */
            getUnreadCount: async () => { var _a; return (_a = (await this.bridge.call('chatGetUnreadCount')).unreadCount) !== null && _a !== void 0 ? _a : 0; },
            /** Çevrimdışı / çalışma saatleri dışında e-postayla mesaj bırakır. */
            leaveOfflineMessage: (email, text, name) => {
                const args = { email: requireString(email, 'email'), text: chatText(text) };
                if (name)
                    args.name = name;
                return this.bridge.call('chatLeaveOfflineMessage', args);
            },
            /** Yazıyor göstergesi (native SDK tekrarları seyreltir). */
            setTyping: (typing) => this.bridge.call('chatSetTyping', { typing: Boolean(typing) }),
            /** Canlı dinlemeyi başlatır; koparsa native SDK geri çekilmeyle yeniden bağlanır ve eksikleri yoklar. */
            startListening: async () => {
                await this.ensureSubscribed();
                return this.bridge.call('chatStartListening');
            },
            /** Canlı dinlemeyi durdurur (arka plana geçişte önerilir; temsilci mesajı push ile gelir). */
            stopListening: () => this.bridge.call('chatStopListening'),
            /** Ek dosyasının adresi; ziyaretçi belirtecini taşır, yalnızca görsel bileşenine verin ve loglamayın. */
            attachmentUrl: async (attachmentId, download = false) => (await this.bridge.call('chatAttachmentUrl', { attachmentId: requireString(attachmentId, 'attachmentId'), download })).url,
            /** Canlı dinleme açık mı (`startListening` çağrıldı ve akış etkin). Web'de her zaman false. */
            isListening: async () => { var _a; return Boolean((_a = (await this.bridge.call('chatIsListening'))) === null || _a === void 0 ? void 0 : _a.listening); },
            /** Bu cihazın ziyaretçi kimliği (sohbet henüz kullanılmadıysa null). */
            getVisitorId: async () => { var _a; return (_a = (await this.bridge.call('chatGetVisitorId')).visitorId) !== null && _a !== void 0 ? _a : null; },
            /** Sohbet olay dinleyicisi; kaldırma fonksiyonu döner. `open`: sohbet bildirimine tıklama. */
            addEventListener: (event, listener) => {
                const set = this.chatListeners[event];
                if (!set)
                    throw new TypeError(`Pushizo: bilinmeyen sohbet olayı '${String(event)}'.`);
                const remove = this.listen(set, listener);
                if (event === 'open') {
                    const pending = this.pendingChatOpens.splice(0);
                    pending.forEach((e) => safeInvoke(listener, e));
                }
                return remove;
            },
            removeEventListener: (event, listener) => {
                var _a;
                (_a = this.chatListeners[event]) === null || _a === void 0 ? void 0 : _a.delete(listener);
            },
        };
        // --- Özellik bayrakları (ADR-0066) ---
        /**
         * Özellik bayrakları: değerler native SDK'da oturum başında yenilenir ve cihazda saklanır; ağ yoksa son değer, hiç
         * alınmadıysa verilen varsayılan döner. Gizlilik onayı beklenirken istek gönderilmez.
         */
        this.FeatureFlags = {
            /** Değerleri sunucudan hemen yeniler; yeni değerler alındıysa true (hata son değerleri korur). */
            refresh: async () => { var _a; return Boolean((_a = (await this.bridge.call('featureFlagsRefresh'))) === null || _a === void 0 ? void 0 : _a.success); },
            /** Bayrak bu kullanıcı için açık mı; değer henüz yoksa `defaultValue`. */
            isEnabled: async (key, defaultValue = false) => {
                var _a;
                const args = { key: requireString(key, 'key'), defaultValue: Boolean(defaultValue) };
                return Boolean((_a = (await this.bridge.call('featureFlagsIsEnabled', args))) === null || _a === void 0 ? void 0 : _a.enabled);
            },
            /** Bayrağın değeri (metin, sayı, mantıksal, nesne veya dizi); değer yoksa `defaultValue`. */
            getValue: async (key, defaultValue = null) => {
                const result = await this.bridge.call('featureFlagsGetValue', {
                    key: requireString(key, 'key'),
                });
                const value = result === null || result === void 0 ? void 0 : result.value;
                return value === undefined || value === null ? defaultValue : value;
            },
        };
        // --- Gömülü yerleşimler (ADR-0068) ---
        /**
         * Gömülü yerleşimler: uygulamanın ayırdığı alana içerik. Model döner, çizim uygulamanındır; içerik ekrana gelince
         * `reportImpression`, düğme tıklanınca `reportClick`, kapatılınca `reportDismiss` çağrılır.
         */
        this.Placements = {
            /** Alanın içeriği (`limit` 1-10, varsayılan 1). Abonelik yoksa veya gizlilik onayı bekleniyorsa boş döner. */
            list: async (key, options = {}) => {
                var _a;
                if (typeof key !== 'string' || !PLACEMENT_KEY.test(key))
                    throw new TypeError('Pushizo: geçersiz yerleşim anahtarı.');
                const limit = (_a = options.limit) !== null && _a !== void 0 ? _a : 1;
                if (!Number.isInteger(limit) || limit < 1 || limit > 10)
                    throw new RangeError('Pushizo: limit 1-10 olmalı.');
                const result = await this.bridge.call('placementsList', { key, limit });
                return Array.isArray(result === null || result === void 0 ? void 0 : result.messages) ? result.messages : [];
            },
            /** Raporlar `list` ile alınmış mesaj içindir; native katmanın tanımadığı mesaj yok sayılır. */
            reportImpression: async (message) => this.bridge.call('placementsReportImpression', { id: placementMessageId(message) }),
            reportClick: async (message, buttonId) => this.bridge.call('placementsReportClick', { id: placementMessageId(message), buttonId: requireString(buttonId, 'buttonId') }),
            reportDismiss: async (message) => this.bridge.call('placementsReportDismiss', { id: placementMessageId(message) }),
        };
        // --- Konum (v2 Faz 17b) ---
        /**
         * Konum paylaşımı (yalnızca ön plan; arka planda koordinat toplanmaz, bölge izleme için `setGeofencingEnabled`).
         * Paylaşım açıkken native SDK konumu oturum başında ve uygulama ön plana döndüğünde en sık 5 dakikada bir push
         * aboneliğine yazar; izin yoksa veya gizlilik onayı verilmemişse hiçbir şey gönderilmez. İlk konum sunucuda KVKK açık
         * rıza kaydı sayılır; `setShared(false)` konumu ve rıza kaydını sildirir. Tercih kalıcıdır. `initialize` öncesinde
         * `setShared`/`requestPermission`/`setGeofencingEnabled` `NOT_READY` ile reddedilir (web: Web SDK hatası).
         */
        this.Location = {
            /** Paylaşımı açar/kapatır (kalıcı). Açılırken izin varsa konum hemen gönderilir; izin için `requestPermission`. */
            setShared: (shared) => this.bridge.call('setLocationShared', { shared: Boolean(shared) }),
            /**
             * Paylaşım açık mı (kalıcı tercih; izin durumundan bağımsız). Native SDK'larda özelliktir (`isShared`); köprü
             * asenkron olduğundan burada Promise döndüren fonksiyondur.
             */
            isShared: async () => { var _a; return Boolean((_a = (await this.bridge.call('isLocationShared'))) === null || _a === void 0 ? void 0 : _a.shared); },
            /**
             * Konum iznini ister (Android `ACCESS_COARSE_LOCATION`/`ACCESS_FINE_LOCATION`, iOS "kullanırken"). İzin yoksa önce
             * açıklama gösterilir (`rationale`; verilmezse SDK'nın yerelleştirilmiş metni), kullanıcı vazgeçerse sistem istemi
             * açılmaz. Sonuç: izin varsa veya verildiyse true; reddedildiyse, uygulama izni tanımlamadıysa veya vazgeçildiyse false.
             */
            requestPermission: async (rationale) => {
                if (rationale !== undefined && rationale !== null && typeof rationale !== 'string') {
                    throw new TypeError('Pushizo: rationale metin olmalı.');
                }
                const args = {};
                if (typeof rationale === 'string' && rationale.trim() !== '')
                    args.rationale = rationale;
                return Boolean((await this.bridge.call('requestLocationPermission', args)).permission);
            },
            /** Ön plan konum izni verilmiş mi (Android yaklaşık/hassas, iOS "kullanırken" veya "her zaman"). Web'de false. */
            permissionGranted: async () => { var _a; return Boolean((_a = (await this.bridge.call('getLocationPermission'))) === null || _a === void 0 ? void 0 : _a.permission); },
            /** Arka plan konum izni verilmiş mi (Android `ACCESS_BACKGROUND_LOCATION`, iOS "her zaman"). Web'de false. */
            backgroundPermissionGranted: async () => { var _a; return Boolean((_a = (await this.bridge.call('getLocationPermission'))) === null || _a === void 0 ? void 0 : _a.background); },
            /**
             * Arka plan konum iznini ister (bölge izleme için). Android: açıklama diyaloğu (`rationale`; verilmezse SDK metni),
             * ardından `ACCESS_BACKGROUND_LOCATION` (Android 11+ sistem Ayarlar ekranını açar; önce ön plan konum izni verilmiş
             * olmalı). iOS: "her zaman" izni (`rationale` yok sayılır; önce "kullanırken" izni verilmiş olmalı). Sonuç: izin
             * varsa veya verildiyse true; reddedildiyse, uygulama izni tanımlamadıysa veya vazgeçildiyse false. Web'de false.
             */
            requestBackgroundPermission: async (rationale) => {
                if (rationale !== undefined && rationale !== null && typeof rationale !== 'string') {
                    throw new TypeError('Pushizo: rationale metin olmalı.');
                }
                const args = {};
                if (typeof rationale === 'string' && rationale.trim() !== '')
                    args.rationale = rationale;
                const result = await this.bridge.call('requestBackgroundLocationPermission', args);
                return Boolean(result === null || result === void 0 ? void 0 : result.permission);
            },
            /** `requestBackgroundPermission` ile aynı izin (iOS adı: "her zaman"); iki ad da her platformda çalışır. */
            requestAlwaysPermission: async () => {
                var _a;
                return Boolean((_a = (await this.bridge.call('requestBackgroundLocationPermission', {}))) === null || _a === void 0 ? void 0 : _a.permission);
            },
            /**
             * Arka plan bölge izlemeyi açar/kapatır (ADR-0065; kalıcı, varsayılan kapalı). İzlemeyi işletim sistemi yapar,
             * sunucuya koordinat gitmez. `setShared(true)` ve arka plan konum izni gerekir (`requestBackgroundPermission`);
             * köprü manifest/Info.plist'e izin eklemez.
             */
            setGeofencingEnabled: (enabled) => this.bridge.call('setGeofencingEnabled', { enabled: Boolean(enabled) }),
            /** Bölge izleme açık mı (kalıcı tercih; izin durumundan bağımsız). */
            isGeofencingEnabled: async () => { var _a; return Boolean((_a = (await this.bridge.call('isGeofencingEnabled'))) === null || _a === void 0 ? void 0 : _a.enabled); },
        };
        // --- Reklam kimliği (ADR-0037) ---
        /**
         * Mobil reklam kimliği (Android GAID, iOS IDFA). SDK reklam kitaplığı ve izin istemi içermez: kimliği uygulama alır
         * (Android `AdvertisingIdClient`, iOS App Tracking Transparency izninden sonra `ASIdentifierManager`) ve buraya verir.
         * Kimlik reklam kitlesine yalnızca `ads_personalization` rızası olan kullanıcıda ve SHA-256 özetiyle gider.
         */
        this.Ads = {
            /** Reklam kimliğini yazar; `null` veya sıfır kimlik sunucudaki kaydı siler. Web'de etkisizdir. */
            setAdvertisingId: (id) => {
                if (id !== null && id !== undefined && typeof id !== 'string') {
                    throw new TypeError('Pushizo: id metin veya null olmalı.');
                }
                return this.bridge.call('setAdvertisingId', { id: typeof id === 'string' && id.trim() !== '' ? id : null });
            },
        };
        // --- Android teslimat güçlendirme (ADR-0092) ---
        /**
         * Android teslimat güçlendirme: bazı üreticilerin pil/otomatik başlatma yöneticisi arka plandaki uygulamayı durdurduğu
         * için bildirimler gecikir ya da gelmez. Bu yüzey cihazdaki kısıtları okur ve kullanıcıyı ilgili ayar ekranına götürür.
         * Yalnızca Android'de etkilidir: iOS ve web'de `status()` `supported: false` ve `risk: 'none'` döner, `openSettings` ile
         * `showGuidance` hiçbir şey yapmadan `false` döner.
         */
        this.Delivery = {
            /** Cihazın teslim durumu: üretici, ROM, pil muafiyeti, arka plan kısıtı, risk ve önerilen ayar ekranları. */
            status: async () => normalizeDeliveryStatus(await this.bridge.call('deliveryStatus')),
            /** Hazır açıklama diyaloğu şimdi gösterilmeli mi: teslim riski var ve diyalog son `minIntervalDays` günde gösterilmedi. */
            shouldShowGuidance: async (minIntervalDays = 14) => {
                if (!Number.isInteger(minIntervalDays) || minIntervalDays < 0) {
                    throw new RangeError('Pushizo: minIntervalDays negatif olmayan tam sayı olmalı.');
                }
                const result = await this.bridge.call('deliveryShouldShowGuidance', { minIntervalDays });
                return Boolean(result === null || result === void 0 ? void 0 : result.show);
            },
            /**
             * Ayar ekranını açar (`auto`: duruma en uygun ekran). Üreticiye özgü ekran bulunamazsa standart Android ekranına
             * düşülür. Bir ekran açıldıysa true.
             */
            openSettings: async (setting = 'auto') => {
                var _a;
                const args = { setting: deliverySetting(setting) };
                return Boolean((_a = (await this.bridge.call('deliveryOpenSettings', args))) === null || _a === void 0 ? void 0 : _a.opened);
            },
            /**
             * Hazır açıklama diyaloğunu gösterir (22 dil; `message` verilirse SDK metni yerine o gösterilir). Kullanıcı kabul
             * ederse `setting` ekranı açılır. Ayar ekranı açıldıysa true; kullanıcı vazgeçtiyse, ekran açılamadıysa ya da etkin
             * Activity yoksa false. SDK diyaloğu kendiliğinden göstermez; uygun anı uygulama seçer (`shouldShowGuidance`).
             */
            showGuidance: async (options = {}) => {
                var _a;
                const message = options.message;
                if (message !== undefined && message !== null && typeof message !== 'string') {
                    throw new TypeError('Pushizo: message metin olmalı.');
                }
                const args = { setting: deliverySetting(options.setting) };
                if (typeof message === 'string' && message.trim() !== '')
                    args.message = message;
                return Boolean((_a = (await this.bridge.call('deliveryShowGuidance', args))) === null || _a === void 0 ? void 0 : _a.opened);
            },
        };
        // --- Live Activities (iOS) ---
        /**
         * iOS Live Activities (ADR-0024; iOS 16.1+). Köprü genel `PushizoDefaultLiveActivityAttributes` türünü kullanır;
         * widget extension'da bu türle `ActivityConfiguration` tanımlanmalı ve sunucuda tür adı aynen kaydedilmelidir.
         * Android ve web `PLATFORM_NOT_SUPPORTED` koduyla reddeder.
         */
        this.LiveActivities = {
            /**
             * Genel türü izlemeye alır: push-to-start belirteci (iOS 17.2+) ve başlayan her etkinliğin güncelleme belirteci
             * sunucuya kaydedilir. `initialize`'dan sonra, uygulama her açıldığında çağrılmalıdır.
             */
            setupDefaultLiveActivity: () => this.bridge.call('setupDefaultLiveActivity'),
            /**
             * Genel türle yerel bir etkinlik başlatır (iOS 16.1+); sunucu sonraki `update`/`end` çağrılarını `activityId` ile
             * yapar. `attributes` içinde `pushizo` anahtarı ayrılmıştır.
             */
            startDefaultLiveActivity: (activityId, attributes, contentState) => this.bridge.call('startDefaultLiveActivity', {
                activityId: liveActivityId(activityId),
                attributes: liveActivityValues(attributes, 'attributes', RESERVED_LIVE_ACTIVITY_KEY),
                contentState: liveActivityValues(contentState, 'contentState'),
            }),
        };
        // --- Hata ayıklama ---
        this.Debug = {
            setLogLevel: (level) => {
                if (!LOG_LEVELS.includes(level))
                    throw new TypeError(`Pushizo: level ${LOG_LEVELS.join('|')} olmalı.`);
                return this.bridge.call('setLogLevel', { level });
            },
        };
    }
    // --- Olay altyapısı ---
    /** Native olaylarına bir kez abone olur (initialize veya ilk dinleyicide). */
    ensureSubscribed() {
        if (this.subscribed)
            return Promise.resolve();
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
    dispatch(type, payload) {
        var _a;
        switch (type) {
            case 'click':
                this.onClick(payload);
                break;
            case 'foregroundWillDisplay':
                this.onForeground(payload);
                break;
            case 'pushSubscriptionChange': {
                const state = payload;
                this.subscriptionObservers.forEach((l) => safeInvoke(l, state));
                break;
            }
            case 'permissionChange': {
                const event = { permission: Boolean(payload.permission) };
                this.permissionObservers.forEach((l) => safeInvoke(l, event));
                break;
            }
            case 'inAppClick': {
                const raw = payload;
                const event = {
                    message: { id: raw.message.id },
                    result: { actionId: raw.result.actionId, url: (_a = raw.result.url) !== null && _a !== void 0 ? _a : null },
                };
                this.inAppClickListeners.forEach((l) => safeInvoke(l, event));
                break;
            }
            case 'inAppLifecycle': {
                const raw = payload;
                if (!LIFECYCLE_EVENTS.includes(raw.event))
                    return;
                const event = { event: raw.event, message: { id: raw.message.id } };
                this.inAppLifecycleListeners.forEach((l) => {
                    const fn = l[raw.event];
                    if (fn)
                        safeInvoke(fn.bind(l), event);
                });
                break;
            }
            case 'chatEvent':
                this.onChatEvent((payload !== null && payload !== void 0 ? payload : {}));
                break;
            case 'chatOpen':
                this.onChatOpen((payload !== null && payload !== void 0 ? payload : {}));
                break;
            default:
                break;
        }
    }
    onClick(raw) {
        var _a, _b, _c, _d;
        const event = {
            notification: normalizeNotification(raw.notification),
            result: { actionId: (_b = (_a = raw.result) === null || _a === void 0 ? void 0 : _a.actionId) !== null && _b !== void 0 ? _b : null, url: (_d = (_c = raw.result) === null || _c === void 0 ? void 0 : _c.url) !== null && _d !== void 0 ? _d : null },
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
    onForeground(raw) {
        let prevented = false;
        let displayed = false;
        const rawPrevent = raw.preventDefault;
        const bridge = this.bridge;
        const event = {
            notification: normalizeNotification(raw.notification),
            preventDefault: () => {
                prevented = true;
                // Capacitor web: tarayıcı gösterimi senkron engellenir (native köprülerde bu alan yoktur).
                if (typeof rawPrevent === 'function')
                    rawPrevent();
            },
            display: async () => {
                if (displayed)
                    return;
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
    syncForegroundFlag() {
        const enabled = this.foregroundListeners.size > 0;
        if (enabled === this.foregroundFlag)
            return;
        this.foregroundFlag = enabled;
        this.bridge
            .call('setForegroundHandlerEnabled', { enabled })
            .catch((err) => console.error('[Pushizo] ön plan işleyicisi ayarlanamadı', err));
    }
    listen(set, listener) {
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
    async initialize(appIdOrOptions, options = {}) {
        const opts = typeof appIdOrOptions === 'string' ? Object.assign(Object.assign({}, options), { appId: appIdOrOptions }) : Object.assign({}, appIdOrOptions);
        requireString(opts.appId, 'appId');
        if (opts.logLevel !== undefined && !LOG_LEVELS.includes(opts.logLevel)) {
            throw new TypeError(`Pushizo: logLevel ${LOG_LEVELS.join('|')} olmalı.`);
        }
        await this.ensureSubscribed();
        await this.bridge.call('initialize', opts);
        if (this.foregroundListeners.size > 0) {
            this.foregroundFlag = true;
            await this.bridge.call('setForegroundHandlerEnabled', { enabled: true });
        }
    }
    /** KVKK/GDPR onayı (`requiresPrivacyConsent: true` ile başlatıldıysa). */
    setConsentGiven(given) {
        return this.bridge.call('setConsentGiven', { given: Boolean(given) });
    }
    /**
     * Anonim kullanıcıyı kimlikli kullanıcıya bağlar. Identity verification açıksa app moduna göre `identityHash`
     * (eski imza: ikinci argüman metin) ve/veya JWT gerekir: `login(id, { jwt })`. `profile` verilirse e-posta, SMS,
     * etiket ve takma adlar aynı çağrıda ayarlanır: `login(id, { profile: { email: 'ali@ornek.com' } })`; geçersiz
     * e-posta veya telefon girişten önce `INVALID_ARGUMENT` ile reddedilir (yarım kalmış kimlik değişimi olmaz).
     */
    login(externalId, proof) {
        requireString(externalId, 'externalId');
        const { identityHash, jwt, profile } = typeof proof === 'string' ? { identityHash: proof } : (proof !== null && proof !== void 0 ? proof : {});
        const args = { externalId };
        if (identityHash !== undefined && identityHash !== null)
            args.identityHash = requireString(identityHash, 'identityHash');
        if (jwt !== undefined && jwt !== null)
            args.jwt = requireString(jwt, 'jwt');
        if (profile !== undefined && profile !== null)
            args.profile = profileArgs(profile);
        return this.bridge.call('login', args);
    }
    /** Süresi dolan kimlik JWT'sini yeniler (giriş yapmış kullanıcı için); sonraki SDK istekleri yeni belirteci taşır. */
    updateUserJwt(jwt) {
        return this.bridge.call('updateUserJwt', { jwt: requireString(jwt, 'jwt') });
    }
    /** Kullanıcıyı anonim kullanıcıya döndürür; kimlik JWT'si cihazdan silinir. */
    logout() {
        return this.bridge.call('logout');
    }
    cardEvent(id, event) {
        return this.bridge.call('contentCardEvent', { id: requireString(id, 'id'), event });
    }
    /** Native sohbet olayını türüne göre dağıtır. */
    onChatEvent(raw) {
        var _a, _b, _c;
        const str = (v) => (typeof v === 'string' ? v : null);
        const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const emit = (type, event) => {
            this.chatListeners[type].forEach((l) => safeInvoke(l, event));
        };
        switch (raw.type) {
            case 'message':
                emit('message', { message: raw.message });
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
                emit('conversation', { conversationId: (_a = str(raw.conversationId)) !== null && _a !== void 0 ? _a : '', status: (_b = str(raw.status)) !== null && _b !== void 0 ? _b : 'open', botActive: raw.botActive === true });
                break;
            case 'connection':
                emit('connection', { connected: raw.connected === true });
                break;
            case 'error':
                emit('error', { code: (_c = str(raw.code)) !== null && _c !== void 0 ? _c : 'HS_ERROR', message: str(raw.message) });
                break;
            default:
                break;
        }
    }
    onChatOpen(raw) {
        const event = {
            conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : '',
            seq: typeof raw.seq === 'number' ? raw.seq : 0,
        };
        if (this.chatListeners.open.size === 0) {
            this.pendingChatOpens.push(event);
            return;
        }
        this.chatListeners.open.forEach((l) => safeInvoke(l, event));
    }
}
exports.PushizoCore = PushizoCore;
