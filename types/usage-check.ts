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
  const feed: Pushizo.ContentCardFeed = await window.Pushizo.ContentCards.list(20);
  const card: Pushizo.ContentCard | undefined = feed.cards[0];
  if (card) await Pushizo.ContentCards.logImpression(card.id);
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
  const delivery: Pushizo.DeliveryStatus = await Pushizo.Delivery.status();
  const risk: Pushizo.DeliveryRisk = delivery.risk;
  const setting: Pushizo.DeliverySetting = delivery.recommendedSettings[0] ?? 'auto';
  const guidance: Pushizo.DeliveryGuidanceOptions = { setting, message: 'Bildirimleri kaçırmayın' };
  if (risk !== 'none' && (await window.Pushizo.Delivery.shouldShowGuidance(30))) await Pushizo.Delivery.showGuidance(guidance);
  const opened: boolean = await Pushizo.Delivery.openSettings('battery_optimization');
  void opened;
  const refreshed: boolean = await Pushizo.FeatureFlags.refresh();
  const enabled: boolean = await Pushizo.FeatureFlags.isEnabled('yeni_sepet', refreshed);
  const limit: number | null = await window.Pushizo.FeatureFlags.getValue('sepet_limiti', 10);
  const raw: Pushizo.FeatureFlagValue = await Pushizo.FeatureFlags.getValue('tema');
  void enabled;
  void limit;
  void raw;
  const profile: Pushizo.UserProfile = { email: 'ali@ornek.com', sms: '+905551112233', tags: { plan: 'pro', level: 3 }, aliases: { crm: 'c-1' } };
  await Pushizo.login('user_42', { jwt: 'header.payload.signature', profile });
  const ready: boolean = await window.Pushizo.isInitialized();
  void ready;
  const consented: Pushizo.UserPreferences = await Pushizo.User.setAdsPersonalizationConsent(true);
  void consented.preferences;
  const consents: Pushizo.UserConsent[] = await window.Pushizo.User.getConsents();
  const consentedAt: number | null = consents[0]?.updatedAt ?? null;
  void consentedAt;
  await Pushizo.User.registerAdm('amzn1.adm-registration.v3.example');
  await Pushizo.Ads.setAdvertisingId('38400000-8cf0-11bd-b23e-10b96e40000d');
  await window.Pushizo.Ads.setAdvertisingId(null);
  await Pushizo.Notifications.setBadgeCount(3);
  await window.Pushizo.Notifications.clearBadge();
  const foreground: boolean = await Pushizo.Location.permissionGranted();
  const background: boolean = await window.Pushizo.Location.backgroundPermissionGranted();
  const always: boolean = foreground && !background ? await Pushizo.Location.requestBackgroundPermission('Mağazaya yaklaşınca haber vermek için') : await Pushizo.Location.requestAlwaysPermission();
  void always;
  const listening: boolean = await Pushizo.Chat.isListening();
  void listening;
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
