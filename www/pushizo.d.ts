import { PushizoCore } from './core';
/**
 * Pushizo Cordova SDK (eski sağlayıcı v5 yüzeyiyle uyumlu).
 *
 * ```js
 * document.addEventListener('deviceready', async () => {
 *   await Pushizo.initialize('app_…', { apiUrl: 'https://api.example.com' });
 *   await Pushizo.Notifications.requestPermission();
 *   Pushizo.Notifications.addClickListener((e) => console.log(e.result.url));
 * });
 * ```
 */
declare const Pushizo: PushizoCore;
export = Pushizo;
