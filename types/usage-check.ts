// Tip tanımlarının derleme denetimi (yayınlanmaz): genel değişken ve modül kullanımı.
import HeroSignal from './index';

async function usage(): Promise<void> {
  await HeroSignal.initialize('app_test', { logLevel: 'debug' });
  const proof: HeroSignal.LoginOptions = { jwt: 'header.payload.signature' };
  await HeroSignal.login('user_42', proof);
  await window.HeroSignal.updateUserJwt('header.payload.signature');
  const click = (e: HeroSignal.NotificationClickEvent): string | null => e.result.url;
  HeroSignal.Notifications.addClickListener((e) => click(e));
  const page: HeroSignal.InboxPage = await window.HeroSignal.Inbox.list({ limit: 10 });
  void page.unreadCount;
  const input: HeroSignal.PreferenceInput = { category: 'promo', channel: 'email', optedIn: false };
  const prefs: HeroSignal.UserPreferences = await HeroSignal.User.setPreferences([input]);
  const first: HeroSignal.UserPreference | undefined = (await window.HeroSignal.User.getPreferences()).preferences[0];
  void prefs.categories;
  void first;
  const emails: string[] = await HeroSignal.User.getEmails();
  const sms: string[] = await window.HeroSignal.User.getSmsNumbers();
  await HeroSignal.Notifications.removeNotification(emails.length > 0 ? 'ios-request-id' : sms.length);
  await HeroSignal.LiveActivities.setupDefaultLiveActivity();
  const state: Record<string, HeroSignal.LiveActivityValue> = { status: 'Yolda', eta: 12, late: false };
  await window.HeroSignal.LiveActivities.startDefaultLiveActivity('order_42', { title: 'Sipariş #42' }, state);
}

void usage;
