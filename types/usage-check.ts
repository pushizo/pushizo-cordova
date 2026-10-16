// Tip tanımlarının derleme denetimi (yayınlanmaz): genel değişken ve modül kullanımı.
import Pushizo from './index';

async function usage(): Promise<void> {
  await Pushizo.initialize('app_test', { logLevel: 'debug' });
  const proof: Pushizo.LoginOptions = { jwt: 'header.payload.signature' };
  await Pushizo.login('user_42', proof);
  await window.Pushizo.updateUserJwt('header.payload.signature');
  const click = (e: Pushizo.NotificationClickEvent): string | null => e.result.url;
  Pushizo.Notifications.addClickListener((e) => click(e));
  const page: Pushizo.InboxPage = await window.Pushizo.Inbox.list({ limit: 10 });
  void page.unreadCount;
  const input: Pushizo.PreferenceInput = { category: 'promo', channel: 'email', optedIn: false };
  const prefs: Pushizo.UserPreferences = await Pushizo.User.setPreferences([input]);
  const first: Pushizo.UserPreference | undefined = (await window.Pushizo.User.getPreferences()).preferences[0];
  void prefs.categories;
  void first;
  const emails: string[] = await Pushizo.User.getEmails();
  const sms: string[] = await window.Pushizo.User.getSmsNumbers();
  await Pushizo.Notifications.removeNotification(emails.length > 0 ? 'ios-request-id' : sms.length);
  await Pushizo.LiveActivities.setupDefaultLiveActivity();
  const state: Record<string, Pushizo.LiveActivityValue> = { status: 'Yolda', eta: 12, late: false };
  await window.Pushizo.LiveActivities.startDefaultLiveActivity('order_42', { title: 'Sipariş #42' }, state);
  const granted: boolean = await Pushizo.Location.requestPermission('Yakındaki mağazaları göstermek için');
  await window.Pushizo.Location.setShared(granted);
  const shared: boolean = await Pushizo.Location.isShared();
  void shared;
}

void usage;
