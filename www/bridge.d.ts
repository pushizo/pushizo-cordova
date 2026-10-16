import type { Bridge } from './core';
/** Native hatası; `code` sunucu/SDK hata kodudur (INVALID_ARGUMENT, NOT_READY, NOT_FOUND, …). */
export declare class PushizoError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/** `cordova.exec` taşıma katmanı; olaylar tek bir `keepCallback` kanalından akar. */
export declare function cordovaBridge(): Bridge;
