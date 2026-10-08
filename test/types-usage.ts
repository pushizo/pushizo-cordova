// Tip tanımlarının derleme testi (`npm run typecheck`): global ve modül kullanımı.
import HeroSignalPlugin, { type ForegroundWillDisplayEvent, type InboxPage } from '../types/index.js';

async function usage(): Promise<InboxPage> {
  await HeroSignal.initialize('app_1', { apiUrl: 'https://api.example.com', logLevel: 'debug' });
  await window.HeroSignal.User.addTags({ plan: 'pro', score: 10, vip: true });
  await HeroSignalPlugin.Notifications.removeNotification(42);
  await HeroSignal.Notifications.removeGroupedNotifications('orders');
  HeroSignal.Notifications.addForegroundLifecycleListener((e: ForegroundWillDisplayEvent) => {
    if (e.notification.data.silent === '1') e.preventDefault();
  });
  HeroSignal.InAppMessages.addLifecycleListener({ didDisplay: (e) => console.warn(e.message.id) });
  const granted: boolean = await HeroSignal.Notifications.requestPermission();
  if (!granted) await HeroSignal.Debug.setLogLevel('warn');
  return HeroSignal.Inbox.list({ limit: 20 });
}

void usage;
