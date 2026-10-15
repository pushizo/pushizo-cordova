/*
 * cordova-plugin-herosignal tip tanımları. Eklenti `window.HeroSignal` ve `window.plugins.HeroSignal`
 * olarak yüklenir; TypeScript projelerinde `import HeroSignal = require('cordova-plugin-herosignal')`
 * yerine çoğunlukla genel `HeroSignal` değişkeni kullanılır.
 */
import type { HeroSignalCore } from '../www/core';
import type * as Definitions from '../www/definitions';

declare const HeroSignal: HeroSignalCore;

declare namespace HeroSignal {
  type LogLevel = Definitions.LogLevel;
  type InitializeOptions = Definitions.InitializeOptions;
  type LoginOptions = Definitions.LoginOptions;
  type HeroSignalNotification = Definitions.HeroSignalNotification;
  type NotificationClickEvent = Definitions.NotificationClickEvent;
  type ForegroundWillDisplayEvent = Definitions.ForegroundWillDisplayEvent;
  type PushSubscriptionState = Definitions.PushSubscriptionState;
  type PermissionChangeEvent = Definitions.PermissionChangeEvent;
  type InAppClickEvent = Definitions.InAppClickEvent;
  type InAppLifecycleEvent = Definitions.InAppLifecycleEvent;
  type InAppLifecycleListener = Definitions.InAppLifecycleListener;
  type InAppTriggerValue = Definitions.InAppTriggerValue;
  type LiveActivityValue = Definitions.LiveActivityValue;
  type InboxItem = Definitions.InboxItem;
  type InboxPage = Definitions.InboxPage;
  type InboxListOptions = Definitions.InboxListOptions;
  type PreferenceChannel = Definitions.PreferenceChannel;
  type UserPreference = Definitions.UserPreference;
  type PreferenceCategory = Definitions.PreferenceCategory;
  type UserPreferences = Definitions.UserPreferences;
  type PreferenceInput = Definitions.PreferenceInput;
}

export = HeroSignal;

declare global {
  interface Window {
    HeroSignal: HeroSignalCore;
  }
}
