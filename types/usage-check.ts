// Tip tanımlarının derleme denetimi (yayınlanmaz): genel değişken ve modül kullanımı.
import HeroSignal from './index';

async function usage(): Promise<void> {
  await HeroSignal.initialize('app_test', { logLevel: 'debug' });
  const click = (e: HeroSignal.NotificationClickEvent): string | null => e.result.url;
  HeroSignal.Notifications.addClickListener((e) => click(e));
  const page: HeroSignal.InboxPage = await window.HeroSignal.Inbox.list({ limit: 10 });
  void page.unreadCount;
}

void usage;
