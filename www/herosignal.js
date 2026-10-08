/*
 * HeroSignal Cordova eklentisi: `cordova.exec` köprüsü (plan 06 §6.1, eski sağlayıcı v5 ile uyumlu ad alanları).
 *
 *   document.addEventListener('deviceready', async () => {
 *     await HeroSignal.initialize('app_…', { apiUrl: 'https://api.example.com' });
 *     await HeroSignal.Notifications.requestPermission();
 *     await HeroSignal.login('user_42');
 *     HeroSignal.Notifications.addClickListener((e) => console.log(e.result.url));
 *   });
 *
 * Native olaylar tek bir kalıcı geri çağrı (`keepCallback`) üzerinden `{ type, data }` olarak gelir.
 */
'use strict';

var exec = require('cordova/exec');

var SERVICE = 'HeroSignal';
var LOG_LEVELS = ['none', 'error', 'warn', 'info', 'debug'];

// --- Native çağrı ---

/** Native eylemi çağırır; argüman her zaman tek bir seçenek nesnesidir. */
function call(action, options) {
  return new Promise(function (resolve, reject) {
    exec(
      function (result) {
        resolve(result === undefined || result === 'OK' ? undefined : result);
      },
      function (error) {
        reject(toError(error));
      },
      SERVICE,
      action,
      [options || {}],
    );
  });
}

/** Native hata yükü `{ code, message }` → `Error` (code alanı korunur). */
function toError(error) {
  if (error instanceof Error) return error;
  var message = typeof error === 'string' ? error : (error && error.message) || 'HeroSignal hatası';
  var err = new Error(message);
  err.code = (error && error.code) || 'HS_ERROR';
  return err;
}

/** Senkron doğrulama hatasını reddedilmiş Promise'e çevirir (tüm metotlar Promise döndürür). */
function guarded(fn) {
  return function () {
    try {
      return fn.apply(null, arguments);
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

// --- Argüman dönüşümleri ---

function requireNonEmpty(value, what) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(what + ' gerekli.');
  return value;
}

/** Tag/trigger sözlüğünü native köprünün beklediği dizge sözlüğüne çevirir. */
function toStringRecord(record, what) {
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    throw new TypeError(what + ' bir nesne olmalı.');
  var out = {};
  Object.keys(record).forEach(function (key) {
    var value = record[key];
    if (!key) throw new TypeError(what + ' anahtarı boş olamaz.');
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' && isFinite(value)) out[key] = String(value);
    else if (typeof value === 'boolean') out[key] = value ? 'true' : 'false';
    else throw new TypeError(what + ' "' + key + '" değeri dizge, sayı veya boolean olmalı.');
  });
  return out;
}

function single(key, value, what) {
  var record = {};
  record[requireNonEmpty(key, what + ' anahtarı')] = value;
  return toStringRecord(record, what);
}

function toKeyList(keys, what) {
  if (!Array.isArray(keys)) throw new TypeError(what + ' bir dizi olmalı.');
  return keys.map(function (k) {
    if (typeof k !== 'string' || !k) throw new TypeError(what + ' boş olmayan dizgeler içermeli.');
    return k;
  });
}

function toLogLevel(level) {
  if (LOG_LEVELS.indexOf(level) < 0)
    throw new RangeError('Geçersiz log seviyesi: ' + String(level) + ' (' + LOG_LEVELS.join(', ') + ').');
  return level;
}

/** Android sistem bildirim kimliği (tam sayı) veya iOS dizge kimlik → köprüde dizge. */
function toNotificationId(id) {
  if (typeof id === 'number') {
    if (!isFinite(id) || Math.floor(id) !== id) throw new TypeError('Bildirim kimliği tam sayı olmalı.');
    return String(id);
  }
  return requireNonEmpty(id, 'Bildirim kimliği');
}

function toEventPayload(name, properties, value) {
  var payload = { name: requireNonEmpty(name, 'Olay adı') };
  if (properties !== undefined) {
    if (properties === null || typeof properties !== 'object' || Array.isArray(properties))
      throw new TypeError('Olay özellikleri bir nesne olmalı.');
    payload.properties = JSON.parse(JSON.stringify(properties));
  }
  if (value !== undefined) {
    if (typeof value !== 'number' || !isFinite(value)) throw new TypeError('Olay değeri sonlu bir sayı olmalı.');
    payload.value = value;
  }
  return payload;
}

function toInboxListOptions(options) {
  var limit = options && options.limit !== undefined ? options.limit : 50;
  if (typeof limit !== 'number' || Math.floor(limit) !== limit || limit < 1 || limit > 200)
    throw new RangeError('limit 1-200 arasında bir tam sayı olmalı.');
  return options && options.cursor ? { limit: limit, cursor: options.cursor } : { limit: limit };
}

function toInitializeOptions(appId, options) {
  var out = { appId: requireNonEmpty(appId, 'appId') };
  options = options || {};
  if (options.apiUrl) out.apiUrl = String(options.apiUrl).replace(/\/+$/, '');
  if (options.requiresPrivacyConsent !== undefined) out.requiresPrivacyConsent = !!options.requiresPrivacyConsent;
  if (options.logLevel !== undefined) out.logLevel = toLogLevel(options.logLevel);
  return out;
}

function isGranted(status) {
  return status === 'granted' || status === 'provisional';
}

// --- Olaylar ---

var listeners = {};
var eventChannelOpen = false;
var foregroundListeners = [];

function on(type, cb) {
  if (typeof cb !== 'function') throw new TypeError('Dinleyici bir fonksiyon olmalı.');
  var list = listeners[type] || (listeners[type] = []);
  if (list.indexOf(cb) < 0) list.push(cb);
}

function off(type, cb) {
  var list = listeners[type];
  if (!list) return;
  var i = list.indexOf(cb);
  if (i >= 0) list.splice(i, 1);
}

function emit(type, data) {
  (listeners[type] || []).slice().forEach(function (cb) {
    try {
      cb(data);
    } catch (err) {
      console.error('[HeroSignal] ' + type + ' dinleyicisi hata verdi', err);
    }
  });
}

/** Native ön plan olayı: dinleyiciler senkron karar verir, sonuç native tarafa döner. */
function onForeground(data) {
  var prevented = false;
  var event = {
    notification: data.notification,
    preventDefault: function () {
      prevented = true;
    },
  };
  foregroundListeners.slice().forEach(function (cb) {
    try {
      cb(event);
    } catch (err) {
      console.error('[HeroSignal] ön plan dinleyicisi hata verdi', err);
    }
  });
  call('completeForegroundDisplay', { eventId: data.eventId, display: !prevented }).catch(function () {});
}

/** Native olay kanalını bir kez açar; native taraf kanal açılana kadar olayları (ör. soğuk açılış tıklaması) saklar. */
function openEventChannel() {
  if (eventChannelOpen) return;
  eventChannelOpen = true;
  exec(
    function (message) {
      if (!message || typeof message !== 'object' || !message.type) return;
      if (message.type === 'notificationWillDisplay') onForeground(message.data);
      else emit(message.type, message.data);
    },
    function (error) {
      eventChannelOpen = false;
      console.error('[HeroSignal] olay kanalı kapandı', error);
    },
    SERVICE,
    'registerEventListener',
    [],
  );
}

var lifecycleEvents = {
  willDisplay: 'inAppWillDisplay',
  didDisplay: 'inAppDidDisplay',
  willDismiss: 'inAppWillDismiss',
  didDismiss: 'inAppDidDismiss',
};
var lifecycleBindings = [];

// --- Public API ---

var HeroSignal = {
  /** Uygulama başlangıcında (`deviceready` sonrası) bir kez çağrılır. */
  initialize: guarded(function (appId, options) {
    var payload = toInitializeOptions(appId, options);
    openEventChannel();
    return call('initialize', payload);
  }),

  /** KVKK/GDPR onayı (`requiresPrivacyConsent` açıkken). */
  setConsentGiven: guarded(function (given) {
    return call('setConsentGiven', { given: !!given });
  }),

  /** Anonim cihazı `externalId` kullanıcısına bağlar; identity verification açıksa `identityHash` zorunludur. */
  login: guarded(function (externalId, identityHash) {
    var payload = { externalId: requireNonEmpty(externalId, 'externalId') };
    if (identityHash) payload.identityHash = identityHash;
    return call('login', payload);
  }),

  logout: guarded(function () {
    return call('logout');
  }),

  User: {
    addTag: guarded(function (key, value) {
      return call('addTags', { tags: single(key, value, 'Tag') });
    }),
    addTags: guarded(function (tags) {
      return call('addTags', { tags: toStringRecord(tags, 'Tag') });
    }),
    removeTag: guarded(function (key) {
      return call('removeTags', { keys: toKeyList([key], 'Tag anahtarları') });
    }),
    removeTags: guarded(function (keys) {
      return call('removeTags', { keys: toKeyList(keys, 'Tag anahtarları') });
    }),
    getTags: guarded(function () {
      return call('getTags').then(function (r) {
        return r.tags;
      });
    }),
    addAlias: guarded(function (label, id) {
      return call('addAliases', { aliases: single(label, id, 'Alias') });
    }),
    addAliases: guarded(function (aliases) {
      return call('addAliases', { aliases: toStringRecord(aliases, 'Alias') });
    }),
    removeAlias: guarded(function (label) {
      return call('removeAlias', { label: requireNonEmpty(label, 'Alias etiketi') });
    }),
    setLanguage: guarded(function (code) {
      return call('setLanguage', { code: requireNonEmpty(code, 'Dil kodu') });
    }),
    /** Geçersiz adres native tarafta `INVALID_ARGUMENT` koduyla reddedilir. */
    addEmail: guarded(function (email) {
      return call('addEmail', { email: requireNonEmpty(email, 'E-posta') });
    }),
    removeEmail: guarded(function (email) {
      return call('removeEmail', { email: requireNonEmpty(email, 'E-posta') });
    }),
    /** E.164 numara (`+905551112233`). */
    addSms: guarded(function (phoneNumber) {
      return call('addSms', { phoneNumber: requireNonEmpty(phoneNumber, 'Telefon numarası') });
    }),
    removeSms: guarded(function (phoneNumber) {
      return call('removeSms', { phoneNumber: requireNonEmpty(phoneNumber, 'Telefon numarası') });
    }),
    getExternalId: guarded(function () {
      return call('getUser').then(function (r) {
        return r.externalId;
      });
    }),
    /** HeroSignal kullanıcı kimliği (`user_id`). */
    getId: guarded(function () {
      return call('getUser').then(function (r) {
        return r.id;
      });
    }),

    pushSubscription: {
      getId: guarded(function () {
        return call('getPushSubscription').then(function (s) {
          return s.id;
        });
      }),
      getToken: guarded(function () {
        return call('getPushSubscription').then(function (s) {
          return s.token;
        });
      }),
      getOptedIn: guarded(function () {
        return call('getPushSubscription').then(function (s) {
          return s.optedIn;
        });
      }),
      getState: guarded(function () {
        return call('getPushSubscription');
      }),
      optIn: guarded(function () {
        return call('optIn');
      }),
      optOut: guarded(function () {
        return call('optOut');
      }),
      addObserver: function (cb) {
        on('pushSubscriptionChange', cb);
      },
      removeObserver: function (cb) {
        off('pushSubscriptionChange', cb);
      },
    },
  },

  Notifications: {
    /** İzin verildi mi (iOS provisional dahil). */
    getPermission: guarded(function () {
      return call('getPermission').then(function (r) {
        return r.granted;
      });
    }),
    /** Ayrıntılı durum: granted/denied/default (+ iOS provisional). */
    getPermissionStatus: guarded(function () {
      return call('getPermission').then(function (r) {
        return r.status;
      });
    }),
    /** Sistem izin istemini gösterir; sonuç izin verildi mi. */
    requestPermission: guarded(function () {
      return call('requestPermission').then(function (r) {
        return isGranted(r.status);
      });
    }),
    addClickListener: function (cb) {
      on('notificationClick', cb);
    },
    removeClickListener: function (cb) {
      off('notificationClick', cb);
    },
    /**
     * Ön planda gelen bildirim; dinleyici `event.preventDefault()` çağırırsa gösterilmez. Karar senkron
     * verilmelidir (yanıt gelmezse native SDK 25 sn sonra bildirimi gösterir).
     */
    addForegroundLifecycleListener: function (cb) {
      if (typeof cb !== 'function') throw new TypeError('Dinleyici bir fonksiyon olmalı.');
      if (foregroundListeners.indexOf(cb) >= 0) return;
      foregroundListeners.push(cb);
      if (foregroundListeners.length === 1) call('setForegroundHandlerEnabled', { enabled: true }).catch(function () {});
    },
    removeForegroundLifecycleListener: function (cb) {
      var i = foregroundListeners.indexOf(cb);
      if (i < 0) return;
      foregroundListeners.splice(i, 1);
      if (foregroundListeners.length === 0) call('setForegroundHandlerEnabled', { enabled: false }).catch(function () {});
    },
    /** SDK'nın gösterdiği tüm bildirimleri tepsiden kaldırır. */
    clearAll: guarded(function () {
      return call('clearAll');
    }),
    /** `notification.notificationId` ile tek bildirimi kaldırır (Android: tam sayı, iOS: dizge). */
    removeNotification: guarded(function (id) {
      return call('removeNotification', { id: toNotificationId(id) });
    }),
    /** Grup anahtarı (`hs_group` / iOS `thread-id`) eşleşen bildirimleri kaldırır. */
    removeGroupedNotifications: guarded(function (group) {
      return call('removeGroupedNotifications', { group: requireNonEmpty(group, 'Grup anahtarı') });
    }),
  },

  Session: {
    /** Özel olay / outcome; in-app `event` tetiklerini de değerlendirir. */
    sendEvent: guarded(function (name, properties, value) {
      return call('sendEvent', toEventPayload(name, properties, value));
    }),
  },

  InAppMessages: {
    addTrigger: guarded(function (key, value) {
      return call('addTriggers', { triggers: single(key, value, 'Trigger') });
    }),
    addTriggers: guarded(function (triggers) {
      return call('addTriggers', { triggers: toStringRecord(triggers, 'Trigger') });
    }),
    removeTrigger: guarded(function (key) {
      return call('removeTriggers', { keys: toKeyList([key], 'Trigger anahtarları') });
    }),
    removeTriggers: guarded(function (keys) {
      return call('removeTriggers', { keys: toKeyList(keys, 'Trigger anahtarları') });
    }),
    clearTriggers: guarded(function () {
      return call('clearTriggers');
    }),
    getTriggers: guarded(function () {
      return call('getTriggers').then(function (r) {
        return r.triggers;
      });
    }),
    /** Geçerli ekran adı (`screen` tetikleri); ekrandan çıkarken `null`. */
    setScreen: guarded(function (name) {
      return call('setScreen', { name: typeof name === 'string' && name.trim() ? name : null });
    }),
    /** true iken yeni mesaj gösterilmez (tetikler kaydedilmeye devam eder). */
    setPaused: guarded(function (paused) {
      return call('setInAppPaused', { paused: !!paused });
    }),
    getPaused: guarded(function () {
      return call('getInAppPaused').then(function (r) {
        return r.paused;
      });
    }),
    addClickListener: function (cb) {
      on('inAppClick', cb);
    },
    removeClickListener: function (cb) {
      off('inAppClick', cb);
    },
    addLifecycleListener: function (listener) {
      if (!listener || typeof listener !== 'object') throw new TypeError('Dinleyici bir nesne olmalı.');
      if (lifecycleBindings.some(function (b) { return b.listener === listener; })) return;
      var binding = { listener: listener, callbacks: {} };
      Object.keys(lifecycleEvents).forEach(function (field) {
        if (typeof listener[field] === 'function') {
          binding.callbacks[field] = listener[field];
          on(lifecycleEvents[field], listener[field]);
        }
      });
      lifecycleBindings.push(binding);
    },
    removeLifecycleListener: function (listener) {
      lifecycleBindings = lifecycleBindings.filter(function (b) {
        if (b.listener !== listener) return true;
        Object.keys(b.callbacks).forEach(function (field) {
          off(lifecycleEvents[field], b.callbacks[field]);
        });
        return false;
      });
    },
  },

  Inbox: {
    /** Öğeler (yeniden eskiye), okunmamış sayısı ve sonraki sayfa imleci. */
    list: guarded(function (options) {
      return call('inboxList', toInboxListOptions(options));
    }),
    markRead: guarded(function (id) {
      return call('inboxMarkRead', { id: requireNonEmpty(id, 'Öğe kimliği') }).then(function (r) {
        return r.item;
      });
    }),
    /** Tümünü okundu işaretler; kalan okunmamış sayısını döndürür. */
    markAllRead: guarded(function () {
      return call('inboxMarkAllRead').then(function (r) {
        return r.unreadCount;
      });
    }),
    /** Öğeyi kutudan kaldırır (sunucuda arşivlenir). */
    delete: guarded(function (id) {
      return call('inboxDelete', { id: requireNonEmpty(id, 'Öğe kimliği') });
    }),
    unreadCount: guarded(function () {
      return call('inboxUnreadCount').then(function (r) {
        return r.unreadCount;
      });
    }),
  },

  Debug: {
    setLogLevel: guarded(function (level) {
      return call('setLogLevel', { level: toLogLevel(level) });
    }),
  },
};

module.exports = HeroSignal;
