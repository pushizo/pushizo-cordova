import { HeroSignalCore } from './core';
/**
 * HeroSignal Cordova SDK (eski sağlayıcı v5 yüzeyiyle uyumlu).
 *
 * ```js
 * document.addEventListener('deviceready', async () => {
 *   await HeroSignal.initialize('app_…', { apiUrl: 'https://api.example.com' });
 *   await HeroSignal.Notifications.requestPermission();
 *   HeroSignal.Notifications.addClickListener((e) => console.log(e.result.url));
 * });
 * ```
 */
declare const HeroSignal: HeroSignalCore;
export = HeroSignal;
