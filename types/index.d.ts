/*
 * cordova-plugin-pushizo tip tanımları. Eklenti `window.Pushizo` ve `window.plugins.Pushizo`
 * olarak yüklenir; TypeScript projelerinde `import Pushizo = require('cordova-plugin-pushizo')`
 * yerine çoğunlukla genel `Pushizo` değişkeni kullanılır.
 */
import type { PushizoCore } from '../www/core';
import type * as Definitions from '../www/definitions';

declare const Pushizo: PushizoCore;

declare namespace Pushizo {
  type LogLevel = Definitions.LogLevel;
  type InitializeOptions = Definitions.InitializeOptions;
  type LoginOptions = Definitions.LoginOptions;
  type PushizoNotification = Definitions.PushizoNotification;
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
  type ChatMessage = Definitions.ChatMessage;
  type ChatAttachment = Definitions.ChatAttachment;
  type ChatQuickReply = Definitions.ChatQuickReply;
  type ChatConversation = Definitions.ChatConversation;
  type ChatConversationState = Definitions.ChatConversationState;
  type ChatMessagePage = Definitions.ChatMessagePage;
  type ChatIdentifyResult = Definitions.ChatIdentifyResult;
  type ChatConfig = Definitions.ChatConfig;
  type ChatStartOptions = Definitions.ChatStartOptions;
  type ChatMessagesOptions = Definitions.ChatMessagesOptions;
  type ChatAttachmentSource = Definitions.ChatAttachmentSource;
  type ChatAttachmentOptions = Definitions.ChatAttachmentOptions;
  type ChatEventMap = Definitions.ChatEventMap;
}

export = Pushizo;

declare global {
  interface Window {
    Pushizo: PushizoCore;
  }
}
