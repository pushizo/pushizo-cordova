// Tip tanımlarının derleme denetimi (yayınlanmaz): genel değişken ve modül kullanımı.
import HeroSignal from './index';

async function usage(): Promise<void> {
  await HeroSignal.initialize('app_test', { logLevel: 'debug' });
  const click = (e: HeroSignal.NotificationClickEvent): string | null => e.result.url;
  HeroSignal.Notifications.addClickListener((e) => click(e));
  const page: HeroSignal.InboxPage = await window.HeroSignal.Inbox.list({ limit: 10 });
  void page.unreadCount;
  const input: HeroSignal.PreferenceInput = { category: 'promo', channel: 'email', optedIn: false };
  const prefs: HeroSignal.UserPreferences = await HeroSignal.User.setPreferences([input]);
  const first: HeroSignal.UserPreference | undefined = (await window.HeroSignal.User.getPreferences()).preferences[0];
  void prefs.categories;
  void first;
}

void usage;
