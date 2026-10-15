/*
 * Native köprü sözleşmesi: JS cephesinin çağırdığı her metodun Android (Kotlin) ve iOS (Swift)
 * köprülerinde karşılığı olmalı ve plugin.xml'in andığı dosyalar mevcut olmalı. Native kod bu ortamda
 * derlenemediğinden kaynak metni üzerinden doğrulanır.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
// Windows'ta `core.autocrlf` dosyaları CRLF ile çıkarır; sözleşme denetimi satır sonundan bağımsızdır.
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

/** Cephenin native'e gönderdiği metot adları. */
function facadeMethods(): Set<string> {
  const src = read('src/core.ts');
  return new Set([...src.matchAll(/bridge\.call(?:<[^>]*>)?\('([A-Za-z]+)'/g)].map((m) => m[1]));
}

describe('native sözleşme', () => {
  const methods = facadeMethods();
  // Adaptörde (Activity/izin API'si) ele alınanlar.
  const adapterHandled = new Set(['requestPermission']);

  it('cephe beklenen metot kümesini kullanır', () => {
    expect(methods.size).toBeGreaterThan(30);
    expect(methods.has('initialize')).toBe(true);
    expect(methods.has('inboxList')).toBe(true);
  });

  it('Android çekirdeği her metodu karşılar', () => {
    const kt = read('src/android/com/herosignal/cordova/HeroSignalBridgeCore.kt');
    const handled = new Set([...kt.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    const plugin = read('src/android/com/herosignal/cordova/HeroSignalCordovaPlugin.kt');
    const pluginHandled = new Set([...plugin.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    for (const m of methods) {
      expect(handled.has(m) || (adapterHandled.has(m) && pluginHandled.has(m)), `Android: ${m}`).toBe(true);
    }
    expect(pluginHandled.has('setEventCallback')).toBe(true);
  });

  it('iOS çekirdeği ve Cordova seçicileri her metodu karşılar', () => {
    const swift = read('src/ios/HeroSignalBridgeCore.swift');
    const handled = new Set([...swift.matchAll(/case ((?:"[A-Za-z]+"(?:, )?)+):/g)].flatMap((m) => [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1])));
    const plugin = read('src/ios/HeroSignalCordovaPlugin.swift');
    const selectors = new Set([...plugin.matchAll(/@objc\(([A-Za-z]+):\)/g)].map((m) => m[1]));
    for (const m of methods) {
      expect(handled.has(m), `iOS çekirdek: ${m}`).toBe(true);
      expect(selectors.has(m), `iOS seçici: ${m}`).toBe(true);
    }
    expect(selectors.has('setEventCallback')).toBe(true);
  });

  it('bildirim kaldırma ve e-posta/SMS listeleri gerçek native SDK çağrılarına bağlı', () => {
    expect(methods.has('getContacts')).toBe(true);
    const kt = read('src/android/com/herosignal/cordova/HeroSignalBridgeCore.kt');
    expect(kt).toContain('HeroSignal.Notifications.removeNotification(id)');
    expect(kt).toContain('JSONArray(HeroSignal.User.emails)');
    expect(kt).toContain('JSONArray(HeroSignal.User.smsNumbers)');
    const swift = read('src/ios/HeroSignalBridgeCore.swift');
    expect(swift).toContain('HeroSignal.Notifications.removeNotification(identifier: identifier)');
    expect(swift).toContain('HeroSignal.Notifications.removeGroupedNotifications(group)');
    expect(swift).toContain('"emails": HeroSignal.User.emails, "smsNumbers": HeroSignal.User.smsNumbers');
    expect(swift).not.toMatch(/case "removeNotification": ok\(\)/);
  });

  it('JWT identity verification native SDK çağrılarına iletilir', () => {
    expect(methods.has('updateUserJwt')).toBe(true);
    const kt = read('src/android/com/herosignal/cordova/HeroSignalBridgeCore.kt');
    expect(kt).toContain('HeroSignal.login(args.requireString("externalId"), args.optStringOrNull("identityHash"), args.optStringOrNull("jwt"))');
    expect(kt).toContain('HeroSignal.updateUserJwt(args.requireString("jwt"))');
    const swift = read('src/ios/HeroSignalBridgeCore.swift');
    expect(swift).toContain('HeroSignal.login(externalId, identityHash: identityHash, jwt: jwt)');
    expect(swift).toContain('try HeroSignal.updateUserJwt(jwt)');
  });

  it('Live Activities iOS SDK çağrılarına bağlı, Android PLATFORM_NOT_SUPPORTED ile reddeder', () => {
    expect(methods.has('setupDefaultLiveActivity')).toBe(true);
    expect(methods.has('startDefaultLiveActivity')).toBe(true);
    const swift = read('src/ios/HeroSignalBridgeCore.swift');
    expect(swift).toContain('try HeroSignal.LiveActivities.setupDefaultLiveActivity()');
    expect(swift).toContain('try HeroSignal.LiveActivities.startDefaultLiveActivity(activityId:');
    expect(swift).toContain('catch let error as HSLiveActivityError');
    expect(swift).toContain('reply(.failure(code: error.code, message: error.message))');
    expect(swift).toContain('"LIVE_ACTIVITY_FAILED"');
    const kt = read('src/android/com/herosignal/cordova/HeroSignalBridgeCore.kt');
    expect(kt).toContain('"setupDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE');
    expect(kt).toContain('"startDefaultLiveActivity" -> reply.error(LIVE_ACTIVITY_UNSUPPORTED_CODE');
    expect(kt).toContain('LIVE_ACTIVITY_UNSUPPORTED_CODE = "PLATFORM_NOT_SUPPORTED"');
    expect(kt).toContain('Live Activities yalnızca iOS\'ta desteklenir');
  });

  it('plugin.xml dosya başvuruları mevcut', () => {
    const xml = read('plugin.xml');
    const refs = [...xml.matchAll(/<(?:js-module|source-file|framework)[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]).filter((s) => !s.includes(':'));
    expect(refs.length).toBeGreaterThan(8);
    for (const ref of refs) expect(existsSync(join(root, ref)), ref).toBe(true);
    expect(xml).toContain('com.herosignal.cordova.HeroSignalCordovaPlugin');
    expect(xml).toContain('<param name="ios-package" value="HeroSignalCordovaPlugin" />');
  });

  it('package.json sürümü plugin.xml ile aynı', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(read('plugin.xml')).toContain(`id="cordova-plugin-herosignal"\n        version="${pkg.version}"`);
  });
});
