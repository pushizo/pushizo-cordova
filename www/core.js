"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HeroSignalCore = void 0;
exports.normalizeNotification = normalizeNotification;
const LOG_LEVELS = ['none', 'error', 'warn', 'info', 'debug'];
const LIFECYCLE_EVENTS = ['willDisplay', 'didDisplay', 'willDismiss', 'didDismiss'];
/** Dinleyici hatası diğer dinleyicileri ve native köprüyü etkilemez. */
function safeInvoke(listener, event) {
    try {
        listener(event);
    }
    catch (err) {
        console.error('[HeroSignal] dinleyici hatası', err);
    }
}
function requireString(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`HeroSignal: ${name} boş olmayan bir metin olmalı.`);
    }
    return value;
}
function stringRecord(input, name) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError(`HeroSignal: ${name} bir nesne olmalı.`);
    }
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new TypeError(`HeroSignal: ${name}.${key} metin, sayı veya boolean olmalı.`);
        }
        out[key] = String(value);
    }
    return out;
}
const PREFERENCE_CHANNELS = ['ios_push', 'android_push', 'web_push', 'email', 'sms'];
/** `setPreferences` girdisini yerel SDK kurallarıyla doğrular: 1-100 kayıt, kategori 1-64 karakter, bilinen kanal. */
function preferenceArgs(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
        throw new RangeError('HeroSignal: preferences 1-100 kayıt olmalı.');
    }
    return input.map((p, i) => {
        var _a;
        if (p === null || typeof p !== 'object')
            throw new TypeError(`HeroSignal: preferences[${i}] bir nesne olmalı.`);
        const category = requireString(p.category, `preferences[${i}].category`).trim();
        if (category.length > 64)
            throw new RangeError(`HeroSignal: preferences[${i}].category en fazla 64 karakter olmalı.`);
        const channel = (_a = p.channel) !== null && _a !== void 0 ? _a : null;
        if (channel !== null && !PREFERENCE_CHANNELS.includes(channel)) {
            throw new TypeError(`HeroSignal: preferences[${i}].channel ${PREFERENCE_CHANNELS.join('|')} veya null olmalı.`);
        }
        if (typeof p.optedIn !== 'boolean')
            throw new TypeError(`HeroSignal: preferences[${i}].optedIn boolean olmalı.`);
        return { category, channel, optedIn: p.optedIn };
    });
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
/** Uygulamaların kullandığı HeroSignal cephesi. */
class HeroSignalCore {
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
        this.foregroundFlag = false;
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
            /** Tepsideki/bildirim merkezindeki tüm HeroSignal bildirimlerini kaldırır ve rozeti sıfırlar. */
            clearAll: () => this.bridge.call('clearAll'),
            /**
             * Tek bildirimi kaldırır. Android: `notification.androidNotificationId` (tamsayı). iOS: bildirim isteği kimliği
             * (`UNNotificationRequest.identifier`, metin; tamsayı verilirse metne çevrilir). Web'de `UNAVAILABLE`.
             */
            removeNotification: (id) => {
                if (typeof id === 'string')
                    return this.bridge.call('removeNotification', { identifier: requireString(id, 'identifier') });
                if (!Number.isInteger(id))
                    throw new TypeError('HeroSignal: androidNotificationId tamsayı olmalı.');
                return this.bridge.call('removeNotification', { id });
            },
            /** Aynı gruptaki bildirimleri kaldırır (Android `android_group`, iOS `thread-id`). */
            removeGroupedNotifications: (group) => this.bridge.call('removeGroupedNotifications', { group: requireString(group, 'group') }),
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
                        throw new TypeError('HeroSignal: value sayı olmalı.');
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
                    return Promise.reject(new RangeError('HeroSignal: limit 1-200 olmalı.'));
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
        // --- Hata ayıklama ---
        this.Debug = {
            setLogLevel: (level) => {
                if (!LOG_LEVELS.includes(level))
                    throw new TypeError(`HeroSignal: level ${LOG_LEVELS.join('|')} olmalı.`);
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
            event.display().catch((err) => console.error('[HeroSignal] bildirim gösterilemedi', err));
        }
    }
    syncForegroundFlag() {
        const enabled = this.foregroundListeners.size > 0;
        if (enabled === this.foregroundFlag)
            return;
        this.foregroundFlag = enabled;
        this.bridge
            .call('setForegroundHandlerEnabled', { enabled })
            .catch((err) => console.error('[HeroSignal] ön plan işleyicisi ayarlanamadı', err));
    }
    listen(set, listener) {
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
    async initialize(appIdOrOptions, options = {}) {
        const opts = typeof appIdOrOptions === 'string' ? Object.assign(Object.assign({}, options), { appId: appIdOrOptions }) : Object.assign({}, appIdOrOptions);
        requireString(opts.appId, 'appId');
        if (opts.logLevel !== undefined && !LOG_LEVELS.includes(opts.logLevel)) {
            throw new TypeError(`HeroSignal: logLevel ${LOG_LEVELS.join('|')} olmalı.`);
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
    /** Anonim kullanıcıyı kimlikli kullanıcıya bağlar; identity verification açıksa `identityHash` zorunludur. */
    login(externalId, identityHash) {
        requireString(externalId, 'externalId');
        const args = { externalId };
        if (identityHash !== undefined && identityHash !== null)
            args.identityHash = requireString(identityHash, 'identityHash');
        return this.bridge.call('login', args);
    }
    logout() {
        return this.bridge.call('logout');
    }
}
exports.HeroSignalCore = HeroSignalCore;
