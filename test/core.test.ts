import { describe, expect, it, vi } from 'vitest';

import { HeroSignalCore } from '../src/core';
import type { Bridge, BridgeEventType } from '../src/core';
import type { ForegroundWillDisplayEvent, NotificationClickEvent } from '../src/definitions';

/** Çağrıları kaydeden ve olay işleyicisini dışarı veren sahte taşıma katmanı. */
function fakeBridge(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; args?: Record<string, unknown> }> = [];
  let handler: ((type: BridgeEventType, payload: unknown) => void) | null = null;
  const subscribe = vi.fn((h: (type: BridgeEventType, payload: unknown) => void) => {
    handler = h;
  });
  const bridge: Bridge = {
    call: vi.fn(async (method: string, args?: Record<string, unknown>) => {
      calls.push({ method, args });
      return responses[method] as never;
    }),
    subscribe,
  };
  return {
    bridge,
    calls,
    subscribe,
    emit: (type: BridgeEventType, payload: unknown) => {
      if (!handler) throw new Error('abone olunmadı');
      handler(type, payload);
    },
  };
}

const notification = {
  title: 'Merhaba',
  body: 'Gövde',
  url: 'https://example.com',
  imageUrl: null,
  deliveryId: 'dlv_1',
  messageId: 'msg_1',
  data: { k: 'v' },
  androidNotificationId: 42,
};

describe('HeroSignalCore', () => {
  it('initialize: appId ve seçenekleri iletir, olaylara bir kez abone olur', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    await hs.initialize('app_1', { apiUrl: 'https://api.test', logLevel: 'debug' });
    await hs.initialize({ appId: 'app_1' });
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    expect(f.calls[0]).toEqual({ method: 'initialize', args: { appId: 'app_1', apiUrl: 'https://api.test', logLevel: 'debug' } });
  });

  it('initialize: geçersiz appId ve logLevel reddedilir', async () => {
    const hs = new HeroSignalCore(fakeBridge().bridge);
    await expect(hs.initialize('')).rejects.toThrow(TypeError);
    await expect(hs.initialize('app_1', { logLevel: 'verbose' as never })).rejects.toThrow(/logLevel/);
  });

  it('login identityHash yalnızca verildiğinde gönderilir', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    await hs.login('user_1');
    await hs.login('user_2', 'hash');
    await hs.logout();
    expect(f.calls).toEqual([
      { method: 'login', args: { externalId: 'user_1' } },
      { method: 'login', args: { externalId: 'user_2', identityHash: 'hash' } },
      { method: 'logout', args: undefined },
    ]);
  });

  it('tag/tetik değerleri metne çevrilir, null değerler atlanır, nesne reddedilir', async () => {
    const f = fakeBridge({ getTags: { tags: { plan: 'pro' } }, getTriggers: { triggers: { level: '3' } } });
    const hs = new HeroSignalCore(f.bridge);
    await hs.User.addTags({ plan: 'pro', level: 3, vip: true, skip: null as never });
    await hs.InAppMessages.addTrigger('level', 3);
    expect(f.calls[0].args).toEqual({ tags: { plan: 'pro', level: '3', vip: 'true' } });
    expect(f.calls[1].args).toEqual({ triggers: { level: '3' } });
    expect(() => hs.User.addTags({ bad: {} as never })).toThrow(TypeError);
    expect(await hs.User.getTags()).toEqual({ plan: 'pro' });
    expect(await hs.InAppMessages.getTriggers()).toEqual({ level: '3' });
  });

  it('kullanıcı ve abonelik okuyucuları native yanıtını açar', async () => {
    const f = fakeBridge({
      getUser: { id: 'usr_1', externalId: 'ext_1' },
      getPushSubscription: { id: 'sub_1', token: 'tok', optedIn: true, permission: true },
      getPermission: { permission: false },
      requestPermission: { permission: true },
    });
    const hs = new HeroSignalCore(f.bridge);
    expect(await hs.User.getId()).toBe('usr_1');
    expect(await hs.User.getExternalId()).toBe('ext_1');
    expect(await hs.User.pushSubscription.getId()).toBe('sub_1');
    expect(await hs.User.pushSubscription.getToken()).toBe('tok');
    expect(await hs.User.pushSubscription.getOptedIn()).toBe(true);
    expect(await hs.Notifications.getPermission()).toBe(false);
    expect(await hs.Notifications.requestPermission()).toBe(true);
  });

  it('e-posta, SMS, alias, dil ve olay çağrıları doğru argümanlarla gider', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    await hs.User.addEmail('ali@example.com');
    await hs.User.addSms('+905551112233');
    await hs.User.addAlias('crm_id', '99');
    await hs.User.removeAlias('crm_id');
    await hs.User.setLanguage('tr');
    await hs.Session.sendEvent('purchase', { sku: 'A1' }, 49.9);
    await hs.Debug.setLogLevel('none');
    expect(f.calls.map((c) => [c.method, c.args])).toEqual([
      ['addEmail', { email: 'ali@example.com' }],
      ['addSms', { phoneNumber: '+905551112233' }],
      ['addAliases', { aliases: { crm_id: '99' } }],
      ['removeAlias', { label: 'crm_id' }],
      ['setLanguage', { code: 'tr' }],
      ['sendEvent', { name: 'purchase', properties: { sku: 'A1' }, value: 49.9 }],
      ['setLogLevel', { level: 'none' }],
    ]);
    expect(() => hs.Session.sendEvent('x', {}, Number.NaN)).toThrow(TypeError);
  });

  it('soğuk başlatma tıklaması ilk dinleyiciye teslim edilir', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    await hs.initialize('app_1');
    f.emit('click', { notification, result: { actionId: 'btn_1', url: 'https://x' } });
    const seen: NotificationClickEvent[] = [];
    hs.Notifications.addClickListener((e) => seen.push(e));
    expect(seen).toHaveLength(1);
    expect(seen[0].result).toEqual({ actionId: 'btn_1', url: 'https://x' });
    expect(seen[0].notification.androidNotificationId).toBe(42);
    f.emit('click', { notification: {}, result: {} });
    expect(seen).toHaveLength(2);
    expect(seen[1].notification).toEqual({
      title: null, body: null, url: null, imageUrl: null, deliveryId: null, messageId: null, data: {}, androidNotificationId: null,
    });
  });

  it('dinleyici hatası diğer dinleyicileri durdurmaz', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const second = vi.fn();
    hs.Notifications.addClickListener(() => {
      throw new Error('boom');
    });
    hs.Notifications.addClickListener(second);
    await Promise.resolve();
    f.emit('click', { notification, result: { actionId: null, url: null } });
    expect(second).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  describe('ön plan gösterimi', () => {
    it('dinleyici eklenince native bekletme bayrağı açılır, kaldırılınca kapanır', async () => {
      const f = fakeBridge();
      const hs = new HeroSignalCore(f.bridge);
      const remove = hs.Notifications.addForegroundLifecycleListener(() => undefined);
      remove();
      await Promise.resolve();
      expect(f.calls.filter((c) => c.method === 'setForegroundHandlerEnabled').map((c) => c.args)).toEqual([
        { enabled: true },
        { enabled: false },
      ]);
    });

    it('initialize öncesi eklenen dinleyici için bayrak initialize sonrası gönderilir', async () => {
      const f = fakeBridge();
      const hs = new HeroSignalCore(f.bridge);
      hs.Notifications.addForegroundLifecycleListener(() => undefined);
      await hs.initialize('app_1');
      const methods = f.calls.map((c) => c.method);
      expect(methods.lastIndexOf('setForegroundHandlerEnabled')).toBeGreaterThan(methods.indexOf('initialize'));
    });

    it('engellenmeyen bekleyen bildirim gösterilir', async () => {
      const f = fakeBridge();
      const hs = new HeroSignalCore(f.bridge);
      const seen: ForegroundWillDisplayEvent[] = [];
      hs.Notifications.addForegroundLifecycleListener((e) => seen.push(e));
      await Promise.resolve();
      f.emit('foregroundWillDisplay', { notificationId: 'n1', pending: true, notification });
      expect(seen[0].notification.title).toBe('Merhaba');
      expect(f.calls).toContainEqual({ method: 'displayNotification', args: { notificationId: 'n1' } });
    });

    it('preventDefault gösterimi engeller; sonradan display() bir kez gösterir', async () => {
      const f = fakeBridge();
      const hs = new HeroSignalCore(f.bridge);
      let captured: ForegroundWillDisplayEvent | undefined;
      hs.Notifications.addForegroundLifecycleListener((e) => {
        e.preventDefault();
        captured = e;
      });
      await Promise.resolve();
      f.emit('foregroundWillDisplay', { notificationId: 'n2', pending: true, notification });
      expect(captured?.prevented).toBe(true);
      expect(f.calls.some((c) => c.method === 'displayNotification')).toBe(false);
      await captured!.display();
      await captured!.display();
      expect(f.calls.filter((c) => c.method === 'displayNotification')).toHaveLength(1);
    });

    it('bekletilmeyen (pending=false) olayda display çağrılmaz; web preventDefault iletilir', async () => {
      const f = fakeBridge();
      const hs = new HeroSignalCore(f.bridge);
      const webPrevent = vi.fn();
      hs.Notifications.addForegroundLifecycleListener((e) => e.preventDefault());
      await Promise.resolve();
      const raw = { notificationId: 'web-1', pending: false, notification };
      Object.defineProperty(raw, 'preventDefault', { value: webPrevent, enumerable: false });
      f.emit('foregroundWillDisplay', raw);
      expect(webPrevent).toHaveBeenCalledTimes(1);
      expect(f.calls.some((c) => c.method === 'displayNotification')).toBe(false);
    });
  });

  it('abonelik, izin ve in-app olayları ilgili dinleyicilere gider', async () => {
    const f = fakeBridge();
    const hs = new HeroSignalCore(f.bridge);
    const sub = vi.fn();
    const perm = vi.fn();
    const inAppClick = vi.fn();
    const didDisplay = vi.fn();
    const removeSub = hs.User.pushSubscription.addObserver(sub);
    hs.Notifications.addPermissionObserver(perm);
    hs.InAppMessages.addClickListener(inAppClick);
    hs.InAppMessages.addLifecycleListener({ didDisplay });
    await Promise.resolve();
    const state = { id: 'sub_1', token: 't', optedIn: true, permission: true };
    f.emit('pushSubscriptionChange', state);
    f.emit('permissionChange', { permission: true });
    f.emit('inAppClick', { message: { id: 'iam_1' }, result: { actionId: 'b1' } });
    f.emit('inAppLifecycle', { event: 'didDisplay', message: { id: 'iam_1' } });
    f.emit('inAppLifecycle', { event: 'willDisplay', message: { id: 'iam_1' } });
    f.emit('inAppLifecycle', { event: 'unknown', message: { id: 'iam_1' } });
    removeSub();
    f.emit('pushSubscriptionChange', state);
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith(state);
    expect(perm).toHaveBeenCalledWith({ permission: true });
    expect(inAppClick).toHaveBeenCalledWith({ message: { id: 'iam_1' }, result: { actionId: 'b1', url: null } });
    expect(didDisplay).toHaveBeenCalledTimes(1);
    expect(didDisplay).toHaveBeenCalledWith({ event: 'didDisplay', message: { id: 'iam_1' } });
  });

  it('bildirim kutusu: limit doğrulanır, sonuçlar açılır', async () => {
    const page = { items: [], unreadCount: 3, nextCursor: null, hasMore: false };
    const f = fakeBridge({
      inboxList: page,
      inboxMarkRead: { id: 'i1', read: true },
      inboxMarkAllRead: { unreadCount: 0 },
      inboxUnreadCount: { unreadCount: 5 },
    });
    const hs = new HeroSignalCore(f.bridge);
    expect(await hs.Inbox.list({ limit: 20, cursor: 'c1' })).toEqual(page);
    expect(f.calls[0]).toEqual({ method: 'inboxList', args: { limit: 20, cursor: 'c1' } });
    await expect(hs.Inbox.list({ limit: 0 })).rejects.toThrow(RangeError);
    await expect(hs.Inbox.list({ limit: 201 })).rejects.toThrow(RangeError);
    expect(await hs.Inbox.markRead('i1')).toEqual({ id: 'i1', read: true });
    expect(await hs.Inbox.markAllRead()).toBe(0);
    expect(await hs.Inbox.unreadCount()).toBe(5);
    await hs.Inbox.archive('i1');
    expect(f.calls.at(-1)).toEqual({ method: 'inboxArchive', args: { id: 'i1' } });
  });

  it('bildirim tepsisi ve in-app yardımcıları', async () => {
    const f = fakeBridge({ getInAppPaused: { paused: true } });
    const hs = new HeroSignalCore(f.bridge);
    await hs.Notifications.clearAll();
    await hs.Notifications.removeNotification(7);
    await hs.Notifications.removeGroupedNotifications('orders');
    await hs.InAppMessages.setScreen('');
    await hs.InAppMessages.setScreen('checkout');
    await hs.InAppMessages.setPaused(true);
    expect(await hs.InAppMessages.getPaused()).toBe(true);
    expect(() => hs.Notifications.removeNotification(1.5)).toThrow(TypeError);
    expect(f.calls.map((c) => [c.method, c.args])).toEqual([
      ['clearAll', undefined],
      ['removeNotification', { id: 7 }],
      ['removeGroupedNotifications', { group: 'orders' }],
      ['setScreen', { name: null }],
      ['setScreen', { name: 'checkout' }],
      ['setInAppPaused', { paused: true }],
      ['getInAppPaused', undefined],
    ]);
  });
});
