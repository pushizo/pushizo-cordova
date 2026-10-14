import Foundation
import HeroSignal
// SPM: ayrı modül; CocoaPods alt spec'leri tek "HeroSignal" modülünde derlenir.
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import UIKit
import UserNotifications

/// Köprü metot sonucu: başarıda isteğe bağlı sözlük, hatada kod ve mesaj.
enum HeroSignalBridgeResult {
    case success([String: Any]?)
    case failure(code: String, message: String)
}

/// JS `initialize` ayarlarının kalıcı kopyası (yalnızca herkese açık değerler; gizli bilgi tutulmaz).
struct HeroSignalBridgeConfig {
    static let defaultsKey = "herosignal_bridge_config"
    let appId: String
    let apiUrl: String?
    let requiresPrivacyConsent: Bool
    let logLevel: String

    func save() {
        var dict: [String: Any] = ["appId": appId, "requiresPrivacyConsent": requiresPrivacyConsent, "logLevel": logLevel]
        if let apiUrl { dict["apiUrl"] = apiUrl }
        UserDefaults.standard.set(dict, forKey: Self.defaultsKey)
    }

    static func load() -> HeroSignalBridgeConfig? {
        guard let dict = UserDefaults.standard.dictionary(forKey: defaultsKey),
              let appId = dict["appId"] as? String, !appId.isEmpty else { return nil }
        return HeroSignalBridgeConfig(appId: appId, apiUrl: dict["apiUrl"] as? String,
                                      requiresPrivacyConsent: dict["requiresPrivacyConsent"] as? Bool ?? false,
                                      logLevel: dict["logLevel"] as? String ?? "warn")
    }

    /// SDK'yı bu ayarlarla başlatır.
    func initializeSdk() {
        HeroSignal.initialize(appId) { options in
            if let apiUrl { options.apiUrl = apiUrl }
            options.requiresPrivacyConsent = requiresPrivacyConsent
            options.logLevel = HeroSignalBridgeCore.logLevel(logLevel)
        }
    }
}

/**
 Köprüden bağımsız iOS çekirdeği: JS metot adlarını HeroSignal iOS SDK çağrılarına çevirir ve SDK olaylarını
 `emit(tür, veri)` ile köprüye iletir. SDK dinleyicileri kaldırılamadığından süreç başına bir kez eklenir ve
 o anki etkin çekirdeğe yönlendirilir.
 */
final class HeroSignalBridgeCore: NSObject {
    /// Olayların iletileceği etkin çekirdek (köprü yeniden yüklenirse güncellenir).
    fileprivate static weak var active: HeroSignalBridgeCore?
    private static var listenersRegistered = false
    private static let maxPendingForeground = 32

    private let emit: (String, [String: Any]) -> Void
    /// JS tarafında ön plan dinleyicisi varsa gösterim JS kararına bırakılır.
    var foregroundHandlerEnabled = false
    private var foregroundSeq = 0
    private var pendingForeground: [String: HSForegroundEvent] = [:]
    private var pendingOrder: [String] = []
    private let lock = NSLock()

    init(emit: @escaping (String, [String: Any]) -> Void) {
        self.emit = emit
        super.init()
        Self.active = self
    }

    // MARK: Olaylar

    /// SDK başlatılmışsa (kayıtlı ayarlarla) dinleyicileri bağlar.
    func attachIfInitialized() {
        if HeroSignal.isInitialized { registerListeners() }
    }

    private func registerListeners() {
        Self.active = self
        guard !Self.listenersRegistered else { return }
        Self.listenersRegistered = true
        HeroSignal.Notifications.addClickListener { e in
            Self.active?.emit("click", ["notification": Self.map(e.notification),
                                        "result": ["actionId": Self.orNull(e.actionId), "url": Self.orNull(e.url)]])
        }
        HeroSignal.Notifications.addForegroundLifecycleListener { e in
            guard let core = Self.active else { return }
            core.onForeground(e)
        }
        HeroSignal.User.pushSubscription.addObserver { s in
            guard let core = Self.active else { return }
            core.emit("pushSubscriptionChange", Self.map(s))
        }
        // Yerel SDK izin gözlemcisi: izin isteği sonucu ve uygulama yeniden etkinleştiğinde (izin Ayarlar'dan
        // değişmiş olabilir) etkin izin değiştiyse çağrılır.
        HeroSignal.Notifications.addPermissionObserver { granted in
            Self.active?.emit("permissionChange", ["permission": granted])
        }
        HeroSignal.InAppMessages.addClickListener { e in
            Self.active?.emit("inAppClick", ["message": ["id": e.messageId], "result": ["actionId": e.actionId, "url": Self.orNull(e.url)]])
        }
        HeroSignal.InAppMessages.addLifecycleListener(HeroSignalBridgeLifecycleForwarder.shared)
    }

    private func onForeground(_ event: HSForegroundEvent) {
        lock.lock()
        foregroundSeq += 1
        let id = "fg-\(foregroundSeq)"
        let pending = foregroundHandlerEnabled
        if pending {
            // Yerel gösterim ertelenir; JS `display()` çağırırsa veya hiçbir dinleyici engellemezse gösterilir
            // (yanıt gelmezse SDK 25 sn sonra bildirimi göstermeden kapatır).
            event.preventDefault()
            pendingForeground[id] = event
            pendingOrder.append(id)
            while pendingOrder.count > Self.maxPendingForeground {
                pendingForeground.removeValue(forKey: pendingOrder.removeFirst())
            }
        }
        lock.unlock()
        emit("foregroundWillDisplay", ["notificationId": id, "pending": pending, "notification": Self.map(event.notification)])
    }

    private func takePending(_ id: String) -> HSForegroundEvent? {
        lock.lock()
        defer { lock.unlock() }
        pendingOrder.removeAll { $0 == id }
        return pendingForeground.removeValue(forKey: id)
    }

    fileprivate func emitLifecycle(_ event: String, _ message: HSInAppMessage) {
        emit("inAppLifecycle", ["event": event, "message": ["id": message.id]])
    }

    // MARK: Metotlar

    /// Metodu çalıştırır; bilinmeyen metotta false döner.
    func handle(_ method: String, _ args: [String: Any], reply: @escaping (HeroSignalBridgeResult) -> Void) -> Bool {
        func ok(_ data: [String: Any]? = nil) { reply(.success(data)) }
        func invalid(_ message: String) { reply(.failure(code: "INVALID_ARGUMENT", message: message)) }
        func string(_ key: String) -> String? {
            guard let value = args[key] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            return value
        }
        func stringMap(_ key: String) -> [String: String] {
            (args[key] as? [String: Any] ?? [:]).compactMapValues { value in
                if value is NSNull { return nil }
                return (value as? String) ?? "\(value)"
            }
        }
        func stringList(_ key: String) -> [String] { (args[key] as? [Any] ?? []).compactMap { $0 as? String } }

        switch method {
        case "initialize":
            guard let appId = string("appId") else { invalid("appId gerekli"); return true }
            let config = HeroSignalBridgeConfig(appId: appId, apiUrl: string("apiUrl"),
                                                requiresPrivacyConsent: args["requiresPrivacyConsent"] as? Bool ?? false,
                                                logLevel: string("logLevel") ?? "warn")
            // Soğuk başlatmada (bildirim tıklaması) SDK köprü yüklenir yüklenmez başlatılabilsin diye saklanır.
            config.save()
            config.initializeSdk()
            registerListeners()
            ok()
        case "setConsentGiven": HeroSignal.setConsentGiven(args["given"] as? Bool ?? false); ok()
        case "login":
            guard let externalId = string("externalId") else { invalid("externalId gerekli"); return true }
            HeroSignal.login(externalId, identityHash: string("identityHash")); ok()
        case "logout": HeroSignal.logout(); ok()

        case "addTags": HeroSignal.User.addTags(stringMap("tags")); ok()
        case "removeTags": HeroSignal.User.removeTags(stringList("keys")); ok()
        case "getTags": ok(["tags": HeroSignal.User.getTags()])
        case "addAliases": HeroSignal.User.addAliases(stringMap("aliases")); ok()
        case "removeAlias":
            guard let label = string("label") else { invalid("label gerekli"); return true }
            HeroSignal.User.removeAlias(label); ok()
        case "setLanguage":
            guard let code = string("code") else { invalid("code gerekli"); return true }
            HeroSignal.User.setLanguage(code); ok()
        case "addEmail", "removeEmail":
            let email = args["email"] as? String ?? ""
            guard HSContacts.normalizeEmail(email) != nil else { invalid("Geçersiz e-posta adresi."); return true }
            if method == "addEmail" { HeroSignal.User.addEmail(email) } else { HeroSignal.User.removeEmail(email) }
            ok()
        case "addSms", "removeSms":
            let phone = args["phoneNumber"] as? String ?? ""
            guard HSContacts.normalizePhone(phone) != nil else { invalid("Geçersiz telefon numarası (E.164 bekleniyor)."); return true }
            if method == "addSms" { HeroSignal.User.addSms(phone) } else { HeroSignal.User.removeSms(phone) }
            ok()
        case "getUser": ok(["id": Self.orNull(HeroSignal.User.id), "externalId": Self.orNull(HeroSignal.User.externalId)])
        // Tercihler (ADR-0019 §4): sahiplik kanıtı yerel SDK'da eklenir; doğrulama hatası INVALID_ARGUMENT, abonelik yoksa NOT_READY.
        case "getPreferences":
            inbox(reply) { Self.map(try await HeroSignal.User.getPreferences()) }
        case "setPreferences":
            guard let raw = args["preferences"] as? [Any] else { invalid("preferences gerekli"); return true }
            let items = raw.compactMap { $0 as? [String: Any] }
            guard items.count == raw.count else { invalid("preferences öğeleri nesne olmalı"); return true }
            let inputs = items.map {
                HSPreferenceInput(category: $0["category"] as? String ?? "", channel: $0["channel"] as? String, optedIn: $0["optedIn"] as? Bool ?? false)
            }
            inbox(reply) { Self.map(try await HeroSignal.User.setPreferences(inputs)) }

        case "getPushSubscription":
            Task {
                let state = await HeroSignal.User.pushSubscription.state()
                DispatchQueue.main.async { ok(Self.map(state)) }
            }
        case "optIn": HeroSignal.User.pushSubscription.optIn(); ok()
        case "optOut": HeroSignal.User.pushSubscription.optOut(); ok()

        case "getPermission":
            Task {
                let status = await HeroSignal.Notifications.permission()
                DispatchQueue.main.async { ok(["permission": Self.granted(status)]) }
            }
        case "requestPermission":
            // İzin değiştiyse `permissionChange` olayını yerel SDK izin gözlemcisi gönderir.
            HeroSignal.Notifications.requestPermission { granted in
                DispatchQueue.main.async { ok(["permission": granted]) }
            }
        case "clearAll": HeroSignal.Notifications.clearAll(); ok()
        // Tekil kaldırma Android tepsi kimliği ister; iOS'ta karşılığı olmadığından çağrı etkisiz tamamlanır (eski sağlayıcı ile aynı).
        case "removeNotification": ok()
        case "removeGroupedNotifications":
            guard let group = string("group") else { invalid("group gerekli"); return true }
            HeroSignal.Notifications.removeGroupedNotifications(group); ok()
        case "setForegroundHandlerEnabled": foregroundHandlerEnabled = args["enabled"] as? Bool ?? false; ok()
        case "displayNotification":
            guard let id = string("notificationId") else { invalid("notificationId gerekli"); return true }
            guard let event = takePending(id) else {
                reply(.failure(code: "NOT_FOUND", message: "Bildirim bulunamadı veya zaten gösterildi."))
                return true
            }
            event.display()
            ok()

        case "sendEvent":
            guard let name = string("name") else { invalid("name gerekli"); return true }
            HeroSignal.Session.sendEvent(name, properties: args["properties"] as? [String: Any] ?? [:], value: (args["value"] as? NSNumber)?.doubleValue)
            ok()
        case "setLogLevel": HeroSignal.Debug.setLogLevel(Self.logLevel(args["level"] as? String)); ok()

        case "addTriggers": HeroSignal.InAppMessages.addTriggers(stringMap("triggers")); ok()
        case "removeTriggers": HeroSignal.InAppMessages.removeTriggers(stringList("keys")); ok()
        case "clearTriggers": HeroSignal.InAppMessages.clearTriggers(); ok()
        case "getTriggers": ok(["triggers": HeroSignal.InAppMessages.getTriggers()])
        case "setScreen": HeroSignal.InAppMessages.setScreen(args["name"] as? String); ok()
        case "setInAppPaused": HeroSignal.InAppMessages.paused = args["paused"] as? Bool ?? false; ok()
        case "getInAppPaused": ok(["paused": HeroSignal.InAppMessages.paused])

        case "inboxList":
            let limit = (args["limit"] as? NSNumber)?.intValue ?? 50
            let cursor = string("cursor")
            inbox(reply) { Self.map(try await HeroSignal.Inbox.list(limit: limit, cursor: cursor)) }
        case "inboxMarkRead":
            guard let id = string("id") else { invalid("id gerekli"); return true }
            inbox(reply) { Self.map(try await HeroSignal.Inbox.markRead(id)) }
        case "inboxMarkAllRead":
            inbox(reply) { ["unreadCount": try await HeroSignal.Inbox.markAllRead()] }
        case "inboxArchive":
            guard let id = string("id") else { invalid("id gerekli"); return true }
            inbox(reply) { try await HeroSignal.Inbox.archive(id); return nil }
        case "inboxUnreadCount":
            inbox(reply) { ["unreadCount": try await HeroSignal.Inbox.unreadCount()] }
        default:
            return false
        }
        return true
    }

    /// Bildirim kutusu çağrısı: sonuç ana iş parçacığında döner; hata kodu `HSApiError.code` veya SDK durumu.
    private func inbox(_ reply: @escaping (HeroSignalBridgeResult) -> Void, _ body: @escaping () async throws -> [String: Any]?) {
        Task {
            do {
                let value = try await body()
                DispatchQueue.main.async { reply(.success(value)) }
            } catch let error as HSApiError {
                DispatchQueue.main.async { reply(.failure(code: error.code, message: error.message)) }
            } catch let error as HSError {
                let code: String
                switch error {
                case .invalidArgument: code = "INVALID_ARGUMENT"
                case .invalidResponse: code = "HS_ERROR"
                default: code = "NOT_READY"
                }
                DispatchQueue.main.async { reply(.failure(code: code, message: "\(error)")) }
            } catch {
                DispatchQueue.main.async { reply(.failure(code: "HS_ERROR", message: error.localizedDescription)) }
            }
        }
    }

    // MARK: Eşleme

    static func logLevel(_ name: String?) -> HSLog.Level {
        switch name {
        case "none": return HSLog.Level.none
        case "error": return .error
        case "info": return .info
        case "debug": return .debug
        default: return .warn
        }
    }

    static func granted(_ status: UNAuthorizationStatus) -> Bool { status == .authorized || status == .provisional }

    static func orNull(_ value: Any?) -> Any { value ?? NSNull() }

    private static func millis(_ date: Date?) -> Any { date.map { Int64($0.timeIntervalSince1970 * 1000) } ?? NSNull() }

    static func map(_ n: HSNotification) -> [String: Any] {
        ["title": orNull(n.title), "body": orNull(n.body), "url": orNull(n.url), "imageUrl": orNull(n.imageUrl),
         "deliveryId": orNull(n.deliveryId), "messageId": orNull(n.messageId), "data": n.data, "androidNotificationId": NSNull()]
    }

    static func map(_ s: HSPushSubscriptionState) -> [String: Any] {
        ["id": orNull(s.id), "token": orNull(s.token), "optedIn": s.optedIn, "permission": granted(s.permission)]
    }

    static func map(_ item: HSInboxItem) -> [String: Any] {
        ["id": item.id, "messageId": orNull(item.messageId), "title": orNull(item.title), "body": orNull(item.body),
         "url": orNull(item.url), "imageUrl": orNull(item.imageUrl), "data": item.data, "read": item.read,
         "readAt": millis(item.readAt), "archivedAt": millis(item.archivedAt), "expiresAt": millis(item.expiresAt), "createdAt": millis(item.createdAt)]
    }

    static func map(_ p: HSPreference) -> [String: Any] {
        ["category": p.category, "channel": orNull(p.channel), "optedIn": p.optedIn, "explicit": p.explicit,
         "source": orNull(p.source), "updatedAt": millis(p.updatedAt)]
    }

    static func map(_ c: HSMessageCategory) -> [String: Any] {
        ["key": c.key, "name": c.name, "description": c.description, "channels": orNull(c.channels), "defaultOptedIn": c.defaultOptedIn]
    }

    static func map(_ r: HSPreferencesResult) -> [String: Any] {
        ["preferences": r.preferences.map { map($0) }, "categories": r.categories.map { map($0) }]
    }

    static func map(_ page: HSInboxPage) -> [String: Any] {
        ["items": page.items.map { map($0) }, "unreadCount": page.unreadCount, "nextCursor": orNull(page.nextCursor), "hasMore": page.hasMore]
    }
}

/// In-app yaşam döngüsünü etkin çekirdeğe yönlendirir (SDK dinleyiciyi zayıf değil güçlü tutar; tek örnek yeterli).
final class HeroSignalBridgeLifecycleForwarder: HSInAppLifecycleListener {
    static let shared = HeroSignalBridgeLifecycleForwarder()
    func onWillDisplay(_ message: HSInAppMessage) { HeroSignalBridgeCore.active?.emitLifecycle("willDisplay", message) }
    func onDidDisplay(_ message: HSInAppMessage) { HeroSignalBridgeCore.active?.emitLifecycle("didDisplay", message) }
    func onWillDismiss(_ message: HSInAppMessage) { HeroSignalBridgeCore.active?.emitLifecycle("willDismiss", message) }
    func onDidDismiss(_ message: HSInAppMessage) { HeroSignalBridgeCore.active?.emitLifecycle("didDismiss", message) }
}
