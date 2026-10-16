"use strict";
/*
 * cordova-plugin-pushizo giriş modülü: `cordova.exec` köprüsü üzerinden Pushizo cephesi.
 * `plugin.xml` bu modülü `window.Pushizo` ve `window.plugins.Pushizo` olarak yayınlar.
 */
const bridge_1 = require("./bridge");
const core_1 = require("./core");
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
const Pushizo = new core_1.PushizoCore((0, bridge_1.cordovaBridge)());
module.exports = Pushizo;
