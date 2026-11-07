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
  await Pushizo.Location.setGeofencingEnabled(shared);
  const geofencing: boolean = await window.Pushizo.Location.isGeofencingEnabled();
  void geofencing;
  const refreshed: boolean = await Pushizo.FeatureFlags.refresh();
  const enabled: boolean = await Pushizo.FeatureFlags.isEnabled('yeni_sepet', refreshed);
  const limit: number | null = await window.Pushizo.FeatureFlags.getValue('sepet_limiti', 10);
  const raw: Pushizo.FeatureFlagValue = await Pushizo.FeatureFlags.getValue('tema');
  void enabled;
  void limit;
  void raw;
  const options: Pushizo.PlacementListOptions = { limit: 2 };
  const messages: Pushizo.InAppMessage[] = await Pushizo.Placements.list('home_banner', options);
  const placement: Pushizo.InAppMessage | undefined = messages[0];
  if (placement) {
    const block: Pushizo.InAppBlock | undefined = placement.display.blocks[0];
    if (block?.type === 'button') await window.Pushizo.Placements.reportClick(placement, block.id);
    await Pushizo.Placements.reportImpression(placement);
    await Pushizo.Placements.reportDismiss(placement);
  }
}

void usage;
