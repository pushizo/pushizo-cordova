/*
 * `cordova.exec` taşıma katmanı: cephe metot çağrılarını native `Pushizo` servisine iletir,
 * native olaylarını tek bir `keepCallback` kanalından alır.
 */
import type { Bridge, BridgeEventType } from './core';

/** Native servis adı (`plugin.xml` <feature name="Pushizo">). */
const SERVICE = 'Pushizo';

type Exec = (
  success: (result?: unknown) => void,
  fail: (error?: unknown) => void,
  service: string,
  action: string,
  args: unknown[],
) => void;

/** Native hatası; `code` sunucu/SDK hata kodudur (INVALID_ARGUMENT, NOT_READY, NOT_FOUND, …). */
export class PushizoError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PushizoError';
  }
}

function toError(raw: unknown): PushizoError {
  if (raw && typeof raw === 'object') {
    const r = raw as { code?: unknown; message?: unknown };
    const code = typeof r.code === 'string' ? r.code : 'HS_ERROR';
    return new PushizoError(typeof r.message === 'string' ? r.message : code, code);
  }
  return new PushizoError(typeof raw === 'string' ? raw : 'Pushizo hatası', 'HS_ERROR');
}

function resolveExec(): Exec {
  const g = globalThis as { cordova?: { exec?: Exec } };
  const exec = g.cordova?.exec;
  if (typeof exec !== 'function') {
    throw new PushizoError('cordova.exec bulunamadı; `deviceready` olayından sonra çağırın.', 'NOT_READY');
  }
  return exec;
}

/** `cordova.exec` taşıma katmanı; olaylar tek bir `keepCallback` kanalından akar. */
export function cordovaBridge(): Bridge {
  return {
    call<T>(method: string, args?: Record<string, unknown>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let exec: Exec;
        try {
          exec = resolveExec();
        } catch (err) {
          reject(err instanceof Error ? err : toError(err));
          return;
        }
        exec(
          (result) => resolve((result === null || result === '' ? undefined : result) as T),
          (error) => reject(toError(error)),
          SERVICE,
          method,
          [args ?? {}],
        );
      });
    },
    subscribe(handler: (type: BridgeEventType, payload: unknown) => void): void {
      resolveExec()(
        (message) => {
          // İlk yanıt kanalın açıldığını bildiren boş sonuçtur; olaylar { type, payload } biçimindedir.
          if (!message || typeof message !== 'object') return;
          const m = message as { type?: BridgeEventType; payload?: unknown };
          if (m.type) handler(m.type, m.payload ?? {});
        },
        (error) => console.error('[Pushizo] olay kanalı hatası', error),
        SERVICE,
        'setEventCallback',
        [],
      );
    },
  };
}
