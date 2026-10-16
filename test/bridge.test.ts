import { afterEach, describe, expect, it, vi } from 'vitest';

import { cordovaBridge, PushizoError } from '../src/bridge';
import { PushizoCore } from '../src/core';
import type { NotificationClickEvent } from '../src/definitions';

type ExecArgs = [(r?: unknown) => void, (e?: unknown) => void, string, string, unknown[]];

/** `cordova.exec` sahtesi: yanıtlar eylem adına göre verilir, olay kanalı dışarı açılır. */
function installCordova(responses: Record<string, { ok?: unknown; error?: unknown }> = {}) {
  const calls: ExecArgs[] = [];
  let eventChannel: ((message?: unknown) => void) | null = null;
  const exec = vi.fn((...args: ExecArgs) => {
    calls.push(args);
    const [success, fail, , action] = args;
    if (action === 'setEventCallback') {
      eventChannel = success;
      success(null);
      return;
    }
    const r = responses[action];
    if (r?.error !== undefined) fail(r.error);
    else success(r?.ok);
  });
  (globalThis as { cordova?: unknown }).cordova = { exec };
  return {
    exec,
    calls,
    event: (type: string, payload: unknown) => eventChannel?.({ type, payload }),
  };
}

afterEach(() => {
  delete (globalThis as { cordova?: unknown }).cordova;
});

describe('cordovaBridge', () => {
  it('metotları Pushizo servisine tek nesne argümanıyla iletir', async () => {
    const c = installCordova({ getTags: { ok: { tags: { plan: 'pro' } } } });
    const hs = new PushizoCore(cordovaBridge());
    await hs.User.addTag('plan', 'pro');
    expect(await hs.User.getTags()).toEqual({ plan: 'pro' });
    expect(c.calls[0].slice(2)).toEqual(['Pushizo', 'addTags', [{ tags: { plan: 'pro' } }]]);
    expect(c.calls[1].slice(2)).toEqual(['Pushizo', 'getTags', [{}]]);
  });

  it('native hata nesnesi kodu korunarak PushizoError olur', async () => {
    installCordova({ addEmail: { error: { code: 'INVALID_ARGUMENT', message: 'Geçersiz e-posta adresi.' } } });
    const hs = new PushizoCore(cordovaBridge());
    const err = await hs.User.addEmail('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PushizoError);
    expect(err).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Geçersiz e-posta adresi.' });
  });

  it('metin hatası HS_ERROR koduna çevrilir', async () => {
    installCordova({ logout: { error: 'Class not found' } });
    await expect(new PushizoCore(cordovaBridge()).logout()).rejects.toMatchObject({ code: 'HS_ERROR', message: 'Class not found' });
  });

  it('cordova yoksa NOT_READY ile reddeder', async () => {
    await expect(new PushizoCore(cordovaBridge()).logout()).rejects.toMatchObject({ code: 'NOT_READY' });
  });

  it('initialize olay kanalını bir kez açar; olaylar dinleyicilere ulaşır', async () => {
    const c = installCordova();
    const hs = new PushizoCore(cordovaBridge());
    await hs.initialize('app_1');
    await hs.initialize('app_1');
    expect(c.calls.filter((a) => a[3] === 'setEventCallback')).toHaveLength(1);
    const clicks = vi.fn<(e: NotificationClickEvent) => void>();
    hs.Notifications.addClickListener(clicks);
    c.event('click', { notification: { title: 'T' }, result: { actionId: null, url: 'https://x' } });
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(clicks.mock.calls[0][0].result.url).toBe('https://x');
  });

  it('ön plan: engellenmeyen bekleyen bildirim için displayNotification çağrılır', async () => {
    const c = installCordova();
    const hs = new PushizoCore(cordovaBridge());
    hs.Notifications.addForegroundLifecycleListener(() => undefined);
    await hs.initialize('app_1');
    c.event('foregroundWillDisplay', { notificationId: 'fg-1', pending: true, notification: { title: 'T' } });
    await Promise.resolve();
    const actions = c.calls.map((a) => a[3]);
    expect(actions).toContain('setForegroundHandlerEnabled');
    expect(c.calls.find((a) => a[3] === 'displayNotification')?.[4]).toEqual([{ notificationId: 'fg-1' }]);
  });

  it('boş native sonucu undefined olarak döner', async () => {
    installCordova({ optIn: { ok: '' } });
    await expect(new PushizoCore(cordovaBridge()).User.pushSubscription.optIn()).resolves.toBeUndefined();
  });
});

describe('pushizo modülü', () => {
  it('CommonJS dışa aktarımı Pushizo cephesidir', async () => {
    installCordova();
    const mod = await import('../src/pushizo');
    const hs = (mod as unknown as { default: PushizoCore }).default ?? (mod as unknown as PushizoCore);
    expect(hs).toBeInstanceOf(PushizoCore);
    expect(typeof hs.Notifications.addClickListener).toBe('function');
  });
});
