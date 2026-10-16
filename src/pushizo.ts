/*
 * cordova-plugin-pushizo giriş modülü: `cordova.exec` köprüsü üzerinden Pushizo cephesi.
 * `plugin.xml` bu modülü `window.Pushizo` ve `window.plugins.Pushizo` olarak yayınlar.
 */
import { cordovaBridge } from './bridge';
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
const Pushizo = new PushizoCore(cordovaBridge());

export = Pushizo;
