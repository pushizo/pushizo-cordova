/*
 * cordova-plugin-herosignal giriş modülü: `cordova.exec` köprüsü üzerinden HeroSignal cephesi.
 * `plugin.xml` bu modülü `window.HeroSignal` ve `window.plugins.HeroSignal` olarak yayınlar.
 */
import { cordovaBridge } from './bridge';
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
const HeroSignal = new HeroSignalCore(cordovaBridge());

export = HeroSignal;
