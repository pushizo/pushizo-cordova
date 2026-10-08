// `www/herosignal.js` köprüsünün birim testleri: `cordova/exec` taklit edilir, native yanıtlar elle verilir.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'www', 'herosignal.js'), 'utf8');

/** Modülü Cordova'nın `cordova.define` ortamına benzer biçimde yükler. */
function load(responses = {}) {
  const calls = [];
  let eventSink = null;
  const exec = (success, error, service, action, args) => {
    assert.equal(service, 'HeroSignal');
    // Cordova argümanları JSON olarak köprüye geçirir; kopya ayrıca vm bağlamı dışına taşır.
    calls.push({ action, args: JSON.parse(JSON.stringify(args)) });
    if (action === 'registerEventListener') {
      eventSink = success;
      return;
    }
    const response = responses[action];
    queueMicrotask(() => {
      if (response instanceof Error || (response && response.__error)) error(response.__error ?? response);
      else success(typeof response === 'function' ? response(args[0]) : response);
    });
  };
  const module = { exports: {} };
  const errors = [];
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: (id) => {
      assert.equal(id, 'cordova/exec');
      return exec;
    },
    console: { error: (...a) => errors.push(a) },
    Promise,
    queueMicrotask,
    JSON,
    Object,
    Array,
    String,
    Math,
    TypeError,
    RangeError,
    Error,
    isFinite,
  });
  vm.runInContext(source, context, { filename: 'herosignal.js' });
  const last = (action) => [...calls].reverse().find((c) => c.action === action)?.args[0];
  const emit = (type, data) => eventSink({ type, data });
  return { HeroSignal: module.exports, calls, last, emit, errors };
}

const notification = {
  notificationId: '42',
  title: 'Merhaba',
  body: null,
  url: null,
  imageUrl: null,
  deliveryId: 'dlv_1',
  messageId: null,
  groupKey: null,
  actions: [],
  data: { silent: '1' },
};

test('initialize olay kanalını bir kez açar ve seçenekleri sadeleştirir', async () => {
  const { HeroSignal, calls, last } = load();
  await HeroSignal.initialize('app_1', { apiUrl: 'https://api.example.com//', logLevel: 'debug', requiresPrivacyConsent: true });
  await HeroSignal.initialize('app_1');
  assert.equal(calls.filter((c) => c.action === 'registerEventListener').length, 1);
  assert.deepEqual(last('initialize'), { appId: 'app_1' });
  assert.deepEqual(calls.find((c) => c.action === 'initialize').args[0], {
    appId: 'app_1',
    apiUrl: 'https://api.example.com',
    requiresPrivacyConsent: true,
    logLevel: 'debug',
  });
});

test('doğrulama hataları reddedilmiş Promise olarak döner', async () => {
  const { HeroSignal, calls } = load();
  await assert.rejects(HeroSignal.initialize(''), TypeError);
  await assert.rejects(HeroSignal.initialize('app_1', { logLevel: 'verbose' }), RangeError);
  await assert.rejects(HeroSignal.User.addTags({ a: { nested: true } }), TypeError);
  await assert.rejects(HeroSignal.Notifications.removeNotification(1.5), TypeError);
  await assert.rejects(HeroSignal.Inbox.list({ limit: 500 }), RangeError);
  await assert.rejects(HeroSignal.Session.sendEvent('x', undefined, Infinity), TypeError);
  assert.equal(calls.length, 0);
});

test('tag, alias ve trigger değerleri dizgeye çevrilir', async () => {
  const { HeroSignal, last } = load();
  await HeroSignal.User.addTags({ plan: 'pro', score: 10, vip: true });
  assert.deepEqual(last('addTags'), { tags: { plan: 'pro', score: '10', vip: 'true' } });
  await HeroSignal.User.addTag('level', 3);
  assert.deepEqual(last('addTags'), { tags: { level: '3' } });
  await HeroSignal.User.removeTag('level');
  assert.deepEqual(last('removeTags'), { keys: ['level'] });
  await HeroSignal.User.addAlias('crm_id', '42');
  assert.deepEqual(last('addAliases'), { aliases: { crm_id: '42' } });
  await HeroSignal.InAppMessages.addTrigger('cart', false);
  assert.deepEqual(last('addTriggers'), { triggers: { cart: 'false' } });
  await HeroSignal.InAppMessages.setScreen('  ');
  assert.deepEqual(last('setScreen'), { name: null });
});

test('login identityHash yoksa alanı göndermez', async () => {
  const { HeroSignal, last } = load();
  await HeroSignal.login('user_1');
  assert.deepEqual(last('login'), { externalId: 'user_1' });
  await HeroSignal.login('user_1', 'hash');
  assert.deepEqual(last('login'), { externalId: 'user_1', identityHash: 'hash' });
});

test('native yanıtlar açılır', async () => {
  const { HeroSignal } = load({
    getTags: { tags: { plan: 'pro' } },
    getUser: { id: 'u1', externalId: 'e1' },
    getPushSubscription: { id: 's1', token: 'tok', optedIn: true },
    getPermission: { granted: false, status: 'denied' },
    requestPermission: { granted: true, status: 'provisional' },
    getInAppPaused: { paused: true },
    inboxMarkAllRead: { unreadCount: 0 },
    inboxUnreadCount: { unreadCount: 3 },
    inboxMarkRead: { item: { id: 'i1', read: true } },
  });
  assert.deepEqual(await HeroSignal.User.getTags(), { plan: 'pro' });
  assert.equal(await HeroSignal.User.getExternalId(), 'e1');
  assert.equal(await HeroSignal.User.getId(), 'u1');
  assert.equal(await HeroSignal.User.pushSubscription.getToken(), 'tok');
  assert.equal(await HeroSignal.User.pushSubscription.getOptedIn(), true);
  assert.equal(await HeroSignal.Notifications.getPermission(), false);
  assert.equal(await HeroSignal.Notifications.getPermissionStatus(), 'denied');
  assert.equal(await HeroSignal.Notifications.requestPermission(), true);
  assert.equal(await HeroSignal.InAppMessages.getPaused(), true);
  assert.equal(await HeroSignal.Inbox.markAllRead(), 0);
  assert.equal(await HeroSignal.Inbox.unreadCount(), 3);
  assert.deepEqual(await HeroSignal.Inbox.markRead('i1'), { id: 'i1', read: true });
});

test('native hata kodu Error.code olarak korunur', async () => {
  const { HeroSignal } = load({ addEmail: { __error: { code: 'INVALID_ARGUMENT', message: 'Geçersiz e-posta adresi.' } } });
  await assert.rejects(HeroSignal.User.addEmail('x@'), (err) => {
    assert.equal(err.code, 'INVALID_ARGUMENT');
    assert.equal(err.message, 'Geçersiz e-posta adresi.');
    return true;
  });
});

test('bildirim tepsisi ve inbox argümanları', async () => {
  const { HeroSignal, last, calls } = load();
  await HeroSignal.Notifications.clearAll();
  await HeroSignal.Notifications.removeNotification(77);
  assert.deepEqual(last('removeNotification'), { id: '77' });
  await HeroSignal.Notifications.removeNotification('dlv_1');
  assert.deepEqual(last('removeNotification'), { id: 'dlv_1' });
  await HeroSignal.Notifications.removeGroupedNotifications('orders');
  assert.deepEqual(last('removeGroupedNotifications'), { group: 'orders' });
  assert.ok(calls.some((c) => c.action === 'clearAll'));
  await HeroSignal.Inbox.list();
  assert.deepEqual(last('inboxList'), { limit: 50 });
  await HeroSignal.Inbox.list({ limit: 10, cursor: 'c2' });
  assert.deepEqual(last('inboxList'), { limit: 10, cursor: 'c2' });
  await HeroSignal.Inbox.delete('i1');
  assert.deepEqual(last('inboxDelete'), { id: 'i1' });
  await HeroSignal.Session.sendEvent('purchase', { sku: 'A', skip: undefined }, 9.5);
  assert.deepEqual(last('sendEvent'), { name: 'purchase', properties: { sku: 'A' }, value: 9.5 });
});

test('olay kanalı tıklama, abonelik ve in-app olaylarını dağıtır', async () => {
  const { HeroSignal, emit, errors } = load();
  await HeroSignal.initialize('app_1');
  const clicks = [];
  const onClick = (e) => clicks.push(e);
  HeroSignal.Notifications.addClickListener(onClick);
  HeroSignal.Notifications.addClickListener(onClick);
  HeroSignal.Notifications.addClickListener(() => {
    throw new Error('dinleyici hatası');
  });
  emit('notificationClick', { notification, result: { actionId: 'btn', url: null } });
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].result.actionId, 'btn');
  assert.equal(errors.length, 1);
  HeroSignal.Notifications.removeClickListener(onClick);
  emit('notificationClick', { notification, result: { actionId: null, url: null } });
  assert.equal(clicks.length, 1);

  const states = [];
  HeroSignal.User.pushSubscription.addObserver((e) => states.push(e.current));
  emit('pushSubscriptionChange', { current: { id: 's1', token: 't', optedIn: true } });
  assert.deepEqual(states, [{ id: 's1', token: 't', optedIn: true }]);

  const seen = [];
  const listener = { didDisplay: (e) => seen.push(['did', e.message.id]), willDismiss: (e) => seen.push(['will', e.message.id]) };
  HeroSignal.InAppMessages.addLifecycleListener(listener);
  emit('inAppDidDisplay', { message: { id: 'iam_1' } });
  emit('inAppWillDismiss', { message: { id: 'iam_1' } });
  emit('inAppWillDisplay', { message: { id: 'iam_1' } });
  HeroSignal.InAppMessages.removeLifecycleListener(listener);
  emit('inAppDidDisplay', { message: { id: 'iam_2' } });
  assert.deepEqual(seen, [
    ['did', 'iam_1'],
    ['will', 'iam_1'],
  ]);
});

test('ön plan dinleyicisi kararı native tarafa döndürür', async () => {
  const { HeroSignal, emit, last, calls } = load();
  await HeroSignal.initialize('app_1');
  const decide = (e) => {
    if (e.notification.data.silent === '1') e.preventDefault();
  };
  HeroSignal.Notifications.addForegroundLifecycleListener(decide);
  assert.deepEqual(last('setForegroundHandlerEnabled'), { enabled: true });

  emit('notificationWillDisplay', { eventId: 'e1', notification });
  assert.deepEqual(last('completeForegroundDisplay'), { eventId: 'e1', display: false });
  emit('notificationWillDisplay', { eventId: 'e2', notification: { ...notification, data: {} } });
  assert.deepEqual(last('completeForegroundDisplay'), { eventId: 'e2', display: true });

  HeroSignal.Notifications.removeForegroundLifecycleListener(decide);
  assert.deepEqual(last('setForegroundHandlerEnabled'), { enabled: false });
  assert.equal(calls.filter((c) => c.action === 'setForegroundHandlerEnabled').length, 2);
});
