import Foundation
import Pushizo
// SPM: ayrı modül; CocoaPods alt spec'leri tek "Pushizo" modülünde derlenir.
#if canImport(PushizoCore)
import PushizoCore
#endif
import UIKit
import UserNotifications

/// Köprü metot sonucu: başarıda isteğe bağlı sözlük, hatada kod ve mesaj.
enum PushizoBridgeResult {
    case success([String: Any]?)
    case failure(code: String, message: String)
}

/// JS `initialize` ayarlarının kalıcı kopyası (yalnızca herkese açık değerler; gizli bilgi tutulmaz).
struct PushizoBridgeConfig {
    static let defaultsKey = "pushizo_bridge_config"
    let appId: String
    let apiUrl: String?
    let requiresPrivacyConsent: Bool
    let logLevel: String

    func save() {
        var dict: [String: Any] = ["appId": appId, "requiresPrivacyConsent": requiresPrivacyConsent, "logLevel": logLevel]
        if let apiUrl { dict["apiUrl"] = apiUrl }
        UserDefaults.standard.set(dict, forKey: Self.defaultsKey)
    }

    static func load() -> PushizoBridgeConfig? {
        guard let dict = UserDefaults.standard.dictionary(forKey: defaultsKey),
              let appId = dict["appId"] as? String, !appId.isEmpty else { return nil }
        return PushizoBridgeConfig(appId: appId, apiUrl: dict["apiUrl"] as? String,
                                      requiresPrivacyConsent: dict["requiresPrivacyConsent"] as? Bool ?? false,
                                      logLevel: dict["logLevel"] as? String ?? "warn")
    }

    /// SDK'yı bu ayarlarla başlatır.
    func initializeSdk() {
        Pushizo.initialize(appId) { options in
            if let apiUrl { options.apiUrl = apiUrl }
            options.requiresPrivacyConsent = requiresPrivacyConsent
            options.logLevel = PushizoBridgeCore.logLevel(logLevel)
        }
    }
}

/**
 Köprüden bağımsız iOS çekirdeği: JS metot adlarını Pushizo iOS SDK çağrılarına çevirir ve SDK olaylarını
 `emit(tür, veri)` ile köprüye iletir. SDK dinleyicileri kaldırılamadığından süreç başına bir kez eklenir ve
 o anki etkin çekirdeğe yönlendirilir.
 */
final class PushizoBridgeCore: NSObject {
    /// Olayların iletileceği etkin çekirdek (köprü yeniden yüklenirse güncellenir).
    fileprivate static weak var active: PushizoBridgeCore?
    private static var listenersRegistered = false
    private static let maxPendingForeground = 32
    private static let notInitialized = "Önce Pushizo.initialize çağrılmalı"

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
        if Pushizo.isInitialized { registerListeners() }
    }

    private func registerListeners() {
        Self.active = self
        guard !Self.listenersRegistered else { return }
        Self.listenersRegistered = true
        Pushizo.Notifications.addClickListener { e in
            Self.active?.emit("click", ["notification": Self.map(e.notification),
                                        "result": ["actionId": Self.orNull(e.actionId), "url": Self.orNull(e.url)]])
        }
        Pushizo.Notifications.addForegroundLifecycleListener { e in
            guard let core = Self.active else { return }
            core.onForeground(e)
        }
        Pushizo.User.pushSubscription.addObserver { s in
            guard let core = Self.active else { return }
            core.emit("pushSubscriptionChange", Self.map(s))
        }
        // Yerel SDK izin gözlemcisi: izin isteği sonucu ve uygulama yeniden etkinleştiğinde (izin Ayarlar'dan
        // değişmiş olabilir) etkin izin değiştiyse çağrılır.
        Pushizo.Notifications.addPermissionObserver { granted in
            Self.active?.emit("permissionChange", ["permission": granted])
        }
        Pushizo.InAppMessages.addClickListener { e in
            Self.active?.emit("inAppClick", ["message": ["id": e.messageId], "result": ["actionId": e.actionId, "url": Self.orNull(e.url)]])
        }
        Pushizo.InAppMessages.addLifecycleListener(PushizoBridgeLifecycleForwarder.shared)
        // Canlı sohbet olayları → JS `chatEvent`; sohbet bildirimi tıklaması → `chatOpen` (cephe bekletir).
        Pushizo.Chat.addListener { event in
            var body = event.payload
            body["type"] = event.type
            Self.active?.emit("chatEvent", body)
        }
        Pushizo.Chat.addOpenListener { info in
            Self.active?.emit("chatOpen", info.dictionary)
        }
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
    func handle(_ method: String, _ args: [String: Any], reply: @escaping (PushizoBridgeResult) -> Void) -> Bool {
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
            let config = PushizoBridgeConfig(appId: appId, apiUrl: string("apiUrl"),
                                                requiresPrivacyConsent: args["requiresPrivacyConsent"] as? Bool ?? false,
                                                logLevel: string("logLevel") ?? "warn")
            // Soğuk başlatmada (bildirim tıklaması) SDK köprü yüklenir yüklenmez başlatılabilsin diye saklanır.
            config.save()
            config.initializeSdk()
            registerListeners()
            ok()
        case "setConsentGiven": Pushizo.setConsentGiven(args["given"] as? Bool ?? false); ok()
        case "login":
            guard let externalId = string("externalId") else { invalid("externalId gerekli"); return true }
            let identityHash = string("identityHash"), jwt = string("jwt")
            // Kanıt app kipine uymuyorsa Android köprüsündeki gibi reddedilir (yerel SDK yalnızca loglar).
            if let message = Pushizo.loginProofError(identityHash: identityHash, jwt: jwt) {
                reply(.failure(code: "NOT_READY", message: message)); return true
            }
            Pushizo.login(externalId, identityHash: identityHash, jwt: jwt); ok()
        case "updateUserJwt":
            guard let jwt = string("jwt") else { invalid("jwt gerekli"); return true }
            do {
                try Pushizo.updateUserJwt(jwt); ok()
            } catch {
                reply(.failure(code: "NOT_READY", message: "Önce login ile kullanıcı kimliklendirilmeli"))
            }
        case "logout": Pushizo.logout(); ok()

        case "addTags": Pushizo.User.addTags(stringMap("tags")); ok()
        case "removeTags": Pushizo.User.removeTags(stringList("keys")); ok()
        case "getTags": ok(["tags": Pushizo.User.getTags()])
        case "addAliases": Pushizo.User.addAliases(stringMap("aliases")); ok()
        case "removeAlias":
            guard let label = string("label") else { invalid("label gerekli"); return true }
            Pushizo.User.removeAlias(label); ok()
        case "setLanguage":
            guard let code = string("code") else { invalid("code gerekli"); return true }
            Pushizo.User.setLanguage(code); ok()
        case "addEmail", "removeEmail":
            let email = args["email"] as? String ?? ""
            guard HSContacts.normalizeEmail(email) != nil else { invalid("Geçersiz e-posta adresi."); return true }
            if method == "addEmail" { Pushizo.User.addEmail(email) } else { Pushizo.User.removeEmail(email) }
            ok()
        case "addSms", "removeSms":
            let phone = args["phoneNumber"] as? String ?? ""
            guard HSContacts.normalizePhone(phone) != nil else { invalid("Geçersiz telefon numarası (E.164 bekleniyor)."); return true }
            if method == "addSms" { Pushizo.User.addSms(phone) } else { Pushizo.User.removeSms(phone) }
            ok()
        case "getUser": ok(["id": Self.orNull(Pushizo.User.id), "externalId": Self.orNull(Pushizo.User.externalId)])
        case "getContacts": ok(["emails": Pushizo.User.emails, "smsNumbers": Pushizo.User.smsNumbers])
        // Tercihler (ADR-0019 §4): sahiplik kanıtı yerel SDK'da eklenir; doğrulama hatası INVALID_ARGUMENT, abonelik yoksa NOT_READY.
        case "getPreferences":
            inbox(reply) { Self.map(try await Pushizo.User.getPreferences()) }
        case "setPreferences":
            guard let raw = args["preferences"] as? [Any] else { invalid("preferences gerekli"); return true }
            let items = raw.compactMap { $0 as? [String: Any] }
            guard items.count == raw.count else { invalid("preferences öğeleri nesne olmalı"); return true }
            let inputs = items.map {
                HSPreferenceInput(category: $0["category"] as? String ?? "", channel: $0["channel"] as? String, optedIn: $0["optedIn"] as? Bool ?? false)
            }
            inbox(reply) { Self.map(try await Pushizo.User.setPreferences(inputs)) }

        case "getPushSubscription":
            Task {
                let state = await Pushizo.User.pushSubscription.state()
                DispatchQueue.main.async { ok(Self.map(state)) }
            }
        case "optIn": Pushizo.User.pushSubscription.optIn(); ok()
        case "optOut": Pushizo.User.pushSubscription.optOut(); ok()

        case "getPermission":
            Task {
                let status = await Pushizo.Notifications.permission()
                DispatchQueue.main.async { ok(["permission": Self.granted(status)]) }
            }
        case "requestPermission":
            // İzin değiştiyse `permissionChange` olayını yerel SDK izin gözlemcisi gönderir.
            Pushizo.Notifications.requestPermission { granted in
                DispatchQueue.main.async { ok(["permission": granted]) }
            }
        case "clearAll": Pushizo.Notifications.clearAll(); ok()
        // iOS kimliği `UNNotificationRequest.identifier` metnidir; tamsayı verilirse metne çevrilerek aranır.
        case "removeNotification":
            let requested = string("identifier") ?? (args["id"] as? NSNumber).map { "\($0.intValue)" }
            guard let identifier = requested else { invalid("identifier gerekli"); return true }
            Pushizo.Notifications.removeNotification(identifier: identifier); ok()
        case "removeGroupedNotifications":
            guard let group = string("group") else { invalid("group gerekli"); return true }
            Pushizo.Notifications.removeGroupedNotifications(group); ok()
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
            Pushizo.Session.sendEvent(name, properties: args["properties"] as? [String: Any] ?? [:], value: (args["value"] as? NSNumber)?.doubleValue)
            ok()
        case "setLogLevel": Pushizo.Debug.setLogLevel(Self.logLevel(args["level"] as? String)); ok()

        case "addTriggers": Pushizo.InAppMessages.addTriggers(stringMap("triggers")); ok()
        case "removeTriggers": Pushizo.InAppMessages.removeTriggers(stringList("keys")); ok()
        case "clearTriggers": Pushizo.InAppMessages.clearTriggers(); ok()
        case "getTriggers": ok(["triggers": Pushizo.InAppMessages.getTriggers()])
        case "setScreen": Pushizo.InAppMessages.setScreen(args["name"] as? String); ok()
        case "setInAppPaused": Pushizo.InAppMessages.paused = args["paused"] as? Bool ?? false; ok()
        case "getInAppPaused": ok(["paused": Pushizo.InAppMessages.paused])

        case "inboxList":
            let limit = (args["limit"] as? NSNumber)?.intValue ?? 50
            let cursor = string("cursor")
            inbox(reply) { Self.map(try await Pushizo.Inbox.list(limit: limit, cursor: cursor)) }
        case "inboxMarkRead":
            guard let id = string("id") else { invalid("id gerekli"); return true }
            inbox(reply) { Self.map(try await Pushizo.Inbox.markRead(id)) }
        case "inboxMarkAllRead":
            inbox(reply) { ["unreadCount": try await Pushizo.Inbox.markAllRead()] }
        case "inboxArchive":
            guard let id = string("id") else { invalid("id gerekli"); return true }
            inbox(reply) { try await Pushizo.Inbox.archive(id); return nil }
        case "inboxUnreadCount":
            inbox(reply) { ["unreadCount": try await Pushizo.Inbox.unreadCount()] }

        // Konum (v2 Faz 17b; yalnızca ön plan): yerel SDK başlatılmadan çağrılırsa sessizce yok sayılmaz, NOT_READY döner.
        case "setLocationShared":
            guard Pushizo.isInitialized else { reply(.failure(code: "NOT_READY", message: Self.notInitialized)); return true }
            Pushizo.Location.setShared(args["shared"] as? Bool ?? false); ok()
        case "isLocationShared": ok(["shared": Pushizo.Location.isShared])
        case "requestLocationPermission":
            guard Pushizo.isInitialized else { reply(.failure(code: "NOT_READY", message: Self.notInitialized)); return true }
            // Açıklama uyarısı + `requestWhenInUseAuthorization`; sonuç ana iş parçacığında döner.
            Pushizo.Location.requestPermission(rationale: string("rationale")) { granted in ok(["permission": granted]) }

        // Canlı sohbet (ADR-0040): kimlik, kuyruk, akış ve push yerel SDK'dadır.
        case "chatStart":
            let name = string("name"), email = string("email"), language = string("language")
            inbox(reply) { try await Pushizo.Chat.start(name: name, email: email, language: language).dictionary }
        case "chatGetConfig":
            let language = string("language")
            inbox(reply) { try await Pushizo.Chat.getConfig(language: language).dictionary }
        case "chatGetConversation":
            inbox(reply) { try await Pushizo.Chat.getConversation().dictionary }
        case "chatGetMessages":
            let after = (args["afterSeq"] as? NSNumber)?.intValue
            let before = (args["beforeSeq"] as? NSNumber)?.intValue
            let limit = (args["limit"] as? NSNumber)?.intValue ?? 50
            inbox(reply) { try await Pushizo.Chat.getMessages(afterSeq: after, beforeSeq: before, limit: limit).dictionary }
        case "chatSendMessage":
            guard let text = string("text") else { invalid("text gerekli"); return true }
            let optionId = string("optionId")
            inbox(reply) { try await Pushizo.Chat.sendMessage(text, optionId: optionId).dictionary }
        case "chatSendAttachment":
            guard let fileName = string("fileName"), let mimeType = string("mimeType") else { invalid("fileName ve mimeType gerekli"); return true }
            let text = string("text")
            let data: Data
            if let base64 = string("base64") {
                guard let decoded = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { invalid("base64 içerik çözülemedi"); return true }
                data = decoded
            } else if let uri = string("uri"), let url = URL(string: uri), url.isFileURL, let contents = try? Data(contentsOf: url) {
                data = contents
            } else {
                invalid("base64 veya okunabilir bir file:// uri gerekli"); return true
            }
            inbox(reply) { try await Pushizo.Chat.sendAttachment(data, fileName: fileName, mimeType: mimeType, text: text).dictionary }
        case "chatMarkRead":
            let seq = (args["seq"] as? NSNumber)?.intValue ?? 0
            inbox(reply) { ["unreadCount": try await Pushizo.Chat.markRead(seq)] }
        case "chatRefreshUnreadCount":
            inbox(reply) { ["unreadCount": try await Pushizo.Chat.refreshUnreadCount()] }
        case "chatGetUnreadCount": ok(["unreadCount": Pushizo.Chat.unreadCount])
        case "chatLeaveOfflineMessage":
            guard let email = string("email"), let text = string("text") else { invalid("email ve text gerekli"); return true }
            let name = string("name")
            inbox(reply) { try await Pushizo.Chat.leaveOfflineMessage(email: email, text: text, name: name).dictionary }
        case "chatSetTyping": Pushizo.Chat.setTyping(args["typing"] as? Bool ?? false); ok()
        case "chatStartListening": Pushizo.Chat.startListening(); ok()
        case "chatStopListening": Pushizo.Chat.stopListening(); ok()
        case "chatAttachmentUrl":
            guard let attachmentId = string("attachmentId") else { invalid("attachmentId gerekli"); return true }
            let download = args["download"] as? Bool ?? false
            inbox(reply) { ["url": try Pushizo.Chat.attachmentUrl(attachmentId, download: download).absoluteString] }
        case "chatGetVisitorId": ok(["visitorId": Self.orNull(Pushizo.Chat.visitorId)])

        // Live Activities (ADR-0024): genel `PushizoDefaultLiveActivityAttributes` türü; değer doğrulaması yerel SDK'dadır.
        case "setupDefaultLiveActivity":
            liveActivity(reply) { try Pushizo.LiveActivities.setupDefaultLiveActivity() }
        case "startDefaultLiveActivity":
            guard let activityId = string("activityId") else { invalid("activityId gerekli"); return true }
            guard let attributes = args["attributes"] as? [String: Any], let contentState = args["contentState"] as? [String: Any] else {
                invalid("attributes ve contentState nesne olmalı"); return true
            }
            liveActivity(reply) {
                try Pushizo.LiveActivities.startDefaultLiveActivity(activityId: activityId, attributes: attributes, contentState: contentState)
            }
        default:
            return false
        }
        return true
    }

    /// Bildirim kutusu çağrısı: sonuç ana iş parçacığında döner; hata kodu `HSApiError.code` veya SDK durumu.
    private func inbox(_ reply: @escaping (PushizoBridgeResult) -> Void, _ body: @escaping () async throws -> [String: Any]?) {
        Task {
            do {
                let value = try await body()
                DispatchQueue.main.async { reply(.success(value)) }
            } catch let error as HSApiError {
                DispatchQueue.main.async { reply(.failure(code: error.code, message: error.message)) }
            } catch HSChatError.invalidArgument(let message) {
                DispatchQueue.main.async { reply(.failure(code: "INVALID_ARGUMENT", message: message)) }
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

    /// Live Activity çağrısı: `HSLiveActivityError` kodu ve mesajı aynen iletilir; beklenmeyen hata `LIVE_ACTIVITY_FAILED`.
    private func liveActivity(_ reply: (PushizoBridgeResult) -> Void, _ body: () throws -> Void) {
        do {
            try body()
            reply(.success(nil))
        } catch let error as HSLiveActivityError {
            reply(.failure(code: error.code, message: error.message))
        } catch {
            reply(.failure(code: "LIVE_ACTIVITY_FAILED", message: error.localizedDescription))
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
final class PushizoBridgeLifecycleForwarder: HSInAppLifecycleListener {
    static let shared = PushizoBridgeLifecycleForwarder()
    func onWillDisplay(_ message: HSInAppMessage) { PushizoBridgeCore.active?.emitLifecycle("willDisplay", message) }
    func onDidDisplay(_ message: HSInAppMessage) { PushizoBridgeCore.active?.emitLifecycle("didDisplay", message) }
    func onWillDismiss(_ message: HSInAppMessage) { PushizoBridgeCore.active?.emitLifecycle("willDismiss", message) }
    func onDidDismiss(_ message: HSInAppMessage) { PushizoBridgeCore.active?.emitLifecycle("didDismiss", message) }
}
