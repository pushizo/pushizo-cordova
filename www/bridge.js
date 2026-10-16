"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushizoError = void 0;
exports.cordovaBridge = cordovaBridge;
/** Native servis adı (`plugin.xml` <feature name="Pushizo">). */
const SERVICE = 'Pushizo';
/** Native hatası; `code` sunucu/SDK hata kodudur (INVALID_ARGUMENT, NOT_READY, NOT_FOUND, …). */
class PushizoError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'PushizoError';
    }
}
exports.PushizoError = PushizoError;
function toError(raw) {
    if (raw && typeof raw === 'object') {
        const r = raw;
        const code = typeof r.code === 'string' ? r.code : 'HS_ERROR';
        return new PushizoError(typeof r.message === 'string' ? r.message : code, code);
    }
    return new PushizoError(typeof raw === 'string' ? raw : 'Pushizo hatası', 'HS_ERROR');
}
function resolveExec() {
    var _a;
    const g = globalThis;
    const exec = (_a = g.cordova) === null || _a === void 0 ? void 0 : _a.exec;
    if (typeof exec !== 'function') {
        throw new PushizoError('cordova.exec bulunamadı; `deviceready` olayından sonra çağırın.', 'NOT_READY');
    }
    return exec;
}
/** `cordova.exec` taşıma katmanı; olaylar tek bir `keepCallback` kanalından akar. */
function cordovaBridge() {
    return {
        call(method, args) {
            return new Promise((resolve, reject) => {
                let exec;
                try {
                    exec = resolveExec();
                }
                catch (err) {
                    reject(err instanceof Error ? err : toError(err));
                    return;
                }
                exec((result) => resolve((result === null || result === '' ? undefined : result)), (error) => reject(toError(error)), SERVICE, method, [args !== null && args !== void 0 ? args : {}]);
            });
        },
        subscribe(handler) {
            resolveExec()((message) => {
                var _a;
                // İlk yanıt kanalın açıldığını bildiren boş sonuçtur; olaylar { type, payload } biçimindedir.
                if (!message || typeof message !== 'object')
                    return;
                const m = message;
                if (m.type)
                    handler(m.type, (_a = m.payload) !== null && _a !== void 0 ? _a : {});
            }, (error) => console.error('[Pushizo] olay kanalı hatası', error), SERVICE, 'setEventCallback', []);
        },
    };
}
