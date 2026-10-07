"use strict";
/*
 * cordova-plugin-herosignal giriş modülü: `cordova.exec` köprüsü üzerinden HeroSignal cephesi.
 * `plugin.xml` bu modülü `window.HeroSignal` ve `window.plugins.HeroSignal` olarak yayınlar.
 */
const bridge_1 = require("./bridge");
const core_1 = require("./core");
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
const HeroSignal = new core_1.HeroSignalCore((0, bridge_1.cordovaBridge)());
module.exports = HeroSignal;
