import Foundation
import HeroSignal
// SPM: ayrı modül; CocoaPods alt spec'leri tek "HeroSignal" modülünde derlenir.
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import ObjectiveC
import UIKit
import UserNotifications

/**
 Cordova → HeroSignal iOS SDK köprüsü (`www/herosignal.js`). Cordova `CDVPlugin` sınıfları uygulamanın
 bridging header'ı (`#import <Cordova/CDV.h>`) üzerinden görünür. Her eylem tek bir seçenek nesnesi alır;
 olaylar `registerEventListener` ile açılan kalıcı geri çağrıya `{ type, data }` olarak gider.

 Cordova AppDelegate'i APNs token'ını iletmediğinden eklenti, uygulama delegesinin
 `didRegisterForRemoteNotificationsWithDeviceToken` / `didFailToRegister…` metotlarına (varsa özgün uygulamayı
 da çağırarak) bağlanır.
 */
@objc(HeroSignalCordova)
class HeroSignalCordova: CDVPlugin, HSInAppLifecycleListener {
    private var listenersAttached = false
    private var eventCallbackId: String?
    private var pendingEvents: [[String: Any]] = []
    private let lock = NSLock()
    private var foregroundHandlerEnabled = false
    private var pendingForeground: [String: HSForegroundEvent] = [:]
    private static var appDelegateHooked = false
    private static let maxPendingEvents = 50

    override func pluginInitialize() {
        super.pluginInitialize()
        Self.hookAppDelegate()
    }

    // MARK: APNs token (uygulama delegesi kancası)

    private static func hookAppDelegate() {
        guard !appDelegateHooked, let delegate = UIApplication.shared.delegate else { return }
        appDelegateHooked = true
        let cls: AnyClass = type(of: delegate)

        let registerSel = #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:))
        typealias RegisterFn = @convention(c) (AnyObject, Selector, UIApplication, NSData) -> Void
        let registerOriginal = class_getInstanceMethod(cls, registerSel).map { method_getImplementation($0) }
        let registerBlock: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { obj, app, token in
            HeroSignal.setDeviceToken(token as Data)
            if let imp = registerOriginal { unsafeBitCast(imp, to: RegisterFn.self)(obj, registerSel, app, token) }
        }
        install(cls, registerSel, imp_implementationWithBlock(registerBlock), types: "v@:@@")

        let failSel = #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:))
        typealias FailFn = @convention(c) (AnyObject, Selector, UIApplication, NSError) -> Void
        let failOriginal = class_getInstanceMethod(cls, failSel).map { method_getImplementation($0) }
        let failBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { obj, app, error in
            HeroSignal.setDeviceTokenError(error)
            if let imp = failOriginal { unsafeBitCast(imp, to: FailFn.self)(obj, failSel, app, error) }
        }
        install(cls, failSel, imp_implementationWithBlock(failBlock), types: "v@:@@")
    }

    private static func install(_ cls: AnyClass, _ selector: Selector, _ imp: IMP, types: String) {
        if let method = class_getInstanceMethod(cls, selector) {
            method_setImplementation(method, imp)
        } else {
            class_addMethod(cls, selector, imp, types)
        }
    }

    // MARK: Olay kanalı

    private func emit(_ type: String, _ data: [String: Any]) {
        let message: [String: Any] = ["type": type, "data": data]
        lock.lock()
        guard let callbackId = eventCallbackId else {
            if pendingEvents.count >= Self.maxPendingEvents { pendingEvents.removeFirst() }
            pendingEvents.append(message)
            lock.unlock()
            return
        }
        lock.unlock()
        send(message, to: callbackId)
    }

    private func send(_ message: [String: Any], to callbackId: String) {
        let result = CDVPluginResult(status: CDVCommandStatus_OK, messageAs: message)
        result?.setKeepCallbackAs(true)
        commandDelegate.send(result, callbackId: callbackId)
    }

    @objc(registerEventListener:)
    func registerEventListener(_ command: CDVInvokedUrlCommand) {
        lock.lock()
        eventCallbackId = command.callbackId
        let pending = pendingEvents
        pendingEvents.removeAll()
        lock.unlock()
        let noResult = CDVPluginResult(status: CDVCommandStatus_NO_RESULT)
        noResult?.setKeepCallbackAs(true)
        commandDelegate.send(noResult, callbackId: command.callbackId)
        pending.forEach { send($0, to: command.callbackId) }
    }

    private func attachListeners() {
        // SDK'da dinleyici kaldırma yok; bir kez eklenir (initialize tekrar çağrılsa da olaylar çoğalmaz).
        guard !listenersAttached else { return }
        listenersAttached = true
        HeroSignal.Notifications.addClickListener { [weak self] e in
            self?.emit("notificationClick", [
                "notification": HeroSignalCordovaMapper.notification(e.notification),
                "result": ["actionId": e.actionId ?? NSNull(), "url": e.url ?? NSNull()],
            ])
        }
        HeroSignal.Notifications.addForegroundLifecycleListener { [weak self] e in
            guard let self, self.foregroundHandlerEnabled else { return }
            e.preventDefault()
            let eventId = UUID().uuidString
            self.lock.lock()
            self.pendingForeground[eventId] = e
            self.lock.unlock()
            self.emit("notificationWillDisplay", ["eventId": eventId, "notification": HeroSignalCordovaMapper.notification(e.notification)])
        }
        HeroSignal.User.pushSubscription.addObserver { [weak self] s in
            self?.emit("pushSubscriptionChange", ["current": HeroSignalCordovaMapper.subscription(s)])
        }
        HeroSignal.InAppMessages.addClickListener { [weak self] e in
            self?.emit("inAppClick", ["message": ["id": e.messageId], "result": ["actionId": e.actionId, "url": e.url ?? NSNull()]])
        }
        HeroSignal.InAppMessages.addLifecycleListener(self)
    }

    func onWillDisplay(_ message: HSInAppMessage) { emit("inAppWillDisplay", ["message": ["id": message.id]]) }
    func onDidDisplay(_ message: HSInAppMessage) { emit("inAppDidDisplay", ["message": ["id": message.id]]) }
    func onWillDismiss(_ message: HSInAppMessage) { emit("inAppWillDismiss", ["message": ["id": message.id]]) }
    func onDidDismiss(_ message: HSInAppMessage) { emit("inAppDidDismiss", ["message": ["id": message.id]]) }

    // MARK: Yardımcılar

    private func options(_ command: CDVInvokedUrlCommand) -> [String: Any] {
        command.argument(at: 0) as? [String: Any] ?? [:]
    }

    private func ok(_ command: CDVInvokedUrlCommand, _ data: [String: Any]? = nil) {
        let result = data.map { CDVPluginResult(status: CDVCommandStatus_OK, messageAs: $0) } ?? CDVPluginResult(status: CDVCommandStatus_OK)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func fail(_ command: CDVInvokedUrlCommand, code: String, message: String) {
        let result = CDVPluginResult(status: CDVCommandStatus_ERROR, messageAs: ["code": code, "message": message])
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func required(_ command: CDVInvokedUrlCommand, _ key: String) -> String? {
        guard let value = options(command)[key] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty else {
            fail(command, code: "INVALID_ARGUMENT", message: "\(key) gerekli.")
            return nil
        }
        return value
    }

    private func string(_ command: CDVInvokedUrlCommand, _ key: String) -> String? { options(command)[key] as? String }
    private func bool(_ command: CDVInvokedUrlCommand, _ key: String) -> Bool? { (options(command)[key] as? NSNumber)?.boolValue }

    private func takePending(_ eventId: String) -> HSForegroundEvent? {
        lock.lock()
        defer { lock.unlock() }
        return pendingForeground.removeValue(forKey: eventId)
    }

    // MARK: Yaşam döngüsü

    @objc(initialize:)
    func initialize(_ command: CDVInvokedUrlCommand) {
        guard let appId = required(command, "appId") else { return }
        let opts = options(command)
        DispatchQueue.main.async {
            HeroSignal.initialize(appId) { options in
                if let apiUrl = opts["apiUrl"] as? String { options.apiUrl = apiUrl }
                options.requiresPrivacyConsent = (opts["requiresPrivacyConsent"] as? NSNumber)?.boolValue ?? false
                options.logLevel = HeroSignalCordovaMapper.logLevel(opts["logLevel"] as? String)
            }
            self.attachListeners()
            self.ok(command)
        }
    }

    @objc(setConsentGiven:)
    func setConsentGiven(_ command: CDVInvokedUrlCommand) { HeroSignal.setConsentGiven(bool(command, "given") ?? false); ok(command) }

    @objc(login:)
    func login(_ command: CDVInvokedUrlCommand) {
        guard let externalId = required(command, "externalId") else { return }
        HeroSignal.login(externalId, identityHash: string(command, "identityHash"))
        ok(command)
    }

    @objc(logout:)
    func logout(_ command: CDVInvokedUrlCommand) { HeroSignal.logout(); ok(command) }

    // MARK: User

    @objc(addTags:)
    func addTags(_ command: CDVInvokedUrlCommand) { HeroSignal.User.addTags(HeroSignalCordovaMapper.stringMap(options(command)["tags"])); ok(command) }

    @objc(removeTags:)
    func removeTags(_ command: CDVInvokedUrlCommand) { HeroSignal.User.removeTags(HeroSignalCordovaMapper.stringList(options(command)["keys"])); ok(command) }

    @objc(getTags:)
    func getTags(_ command: CDVInvokedUrlCommand) { ok(command, ["tags": HeroSignal.User.getTags()]) }

    @objc(addAliases:)
    func addAliases(_ command: CDVInvokedUrlCommand) { HeroSignal.User.addAliases(HeroSignalCordovaMapper.stringMap(options(command)["aliases"])); ok(command) }

    @objc(removeAlias:)
    func removeAlias(_ command: CDVInvokedUrlCommand) {
        guard let label = required(command, "label") else { return }
        HeroSignal.User.removeAlias(label)
        ok(command)
    }

    @objc(setLanguage:)
    func setLanguage(_ command: CDVInvokedUrlCommand) {
        guard let code = required(command, "code") else { return }
        HeroSignal.User.setLanguage(code)
        ok(command)
    }

    @objc(addEmail:)
    func addEmail(_ command: CDVInvokedUrlCommand) { contact(command, key: "email", add: true) }

    @objc(removeEmail:)
    func removeEmail(_ command: CDVInvokedUrlCommand) { contact(command, key: "email", add: false) }

    @objc(addSms:)
    func addSms(_ command: CDVInvokedUrlCommand) { contact(command, key: "phoneNumber", add: true) }

    @objc(removeSms:)
    func removeSms(_ command: CDVInvokedUrlCommand) { contact(command, key: "phoneNumber", add: false) }

    /// E-posta/SMS: geçersiz adres JS'e `INVALID_ARGUMENT` olarak döner.
    private func contact(_ command: CDVInvokedUrlCommand, key: String, add: Bool) {
        let value = string(command, key) ?? ""
        if key == "email" {
            guard HSContacts.normalizeEmail(value) != nil else { fail(command, code: "INVALID_ARGUMENT", message: "Geçersiz e-posta adresi."); return }
            if add { HeroSignal.User.addEmail(value) } else { HeroSignal.User.removeEmail(value) }
        } else {
            guard HSContacts.normalizePhone(value) != nil else { fail(command, code: "INVALID_ARGUMENT", message: "Geçersiz telefon numarası (E.164 bekleniyor)."); return }
            if add { HeroSignal.User.addSms(value) } else { HeroSignal.User.removeSms(value) }
        }
        ok(command)
    }

    @objc(getUser:)
    func getUser(_ command: CDVInvokedUrlCommand) {
        ok(command, ["id": HeroSignal.User.id ?? NSNull(), "externalId": HeroSignal.User.externalId ?? NSNull()])
    }

    @objc(getPushSubscription:)
    func getPushSubscription(_ command: CDVInvokedUrlCommand) {
        Task { self.ok(command, HeroSignalCordovaMapper.subscription(await HeroSignal.User.pushSubscription.state())) }
    }

    @objc(optIn:)
    func optIn(_ command: CDVInvokedUrlCommand) { HeroSignal.User.pushSubscription.optIn(); ok(command) }

    @objc(optOut:)
    func optOut(_ command: CDVInvokedUrlCommand) { HeroSignal.User.pushSubscription.optOut(); ok(command) }

    // MARK: Notifications

    @objc(getPermission:)
    func getPermission(_ command: CDVInvokedUrlCommand) {
        Task { self.ok(command, HeroSignalCordovaMapper.permission(await HeroSignal.Notifications.permission())) }
    }

    @objc(requestPermission:)
    func requestPermission(_ command: CDVInvokedUrlCommand) {
        HeroSignal.Notifications.requestPermission { _ in
            Task { self.ok(command, HeroSignalCordovaMapper.permission(await HeroSignal.Notifications.permission())) }
        }
    }

    @objc(setForegroundHandlerEnabled:)
    func setForegroundHandlerEnabled(_ command: CDVInvokedUrlCommand) {
        foregroundHandlerEnabled = bool(command, "enabled") ?? false
        if !foregroundHandlerEnabled {
            // Bekleyen kararlar varsayılan davranışa (göster) döner.
            lock.lock()
            let pending = Array(pendingForeground.values)
            pendingForeground.removeAll()
            lock.unlock()
            pending.forEach { $0.display() }
        }
        ok(command)
    }

    @objc(completeForegroundDisplay:)
    func completeForegroundDisplay(_ command: CDVInvokedUrlCommand) {
        guard let eventId = required(command, "eventId") else { return }
        // Gösterilmeyecekse olay bırakılır; SDK `displayTimeout` sonunda bildirimi göstermeden kapatır.
        if let event = takePending(eventId), bool(command, "display") ?? true { event.display() }
        ok(command)
    }

    @objc(clearAll:)
    func clearAll(_ command: CDVInvokedUrlCommand) { HeroSignal.Notifications.clearAll(); ok(command) }

    @objc(removeNotification:)
    func removeNotification(_ command: CDVInvokedUrlCommand) {
        guard let id = required(command, "id") else { return }
        HeroSignal.Notifications.removeNotification(id: id)
        ok(command)
    }

    @objc(removeGroupedNotifications:)
    func removeGroupedNotifications(_ command: CDVInvokedUrlCommand) {
        guard let group = required(command, "group") else { return }
        HeroSignal.Notifications.removeGroupedNotifications(group: group)
        ok(command)
    }

    // MARK: Session

    @objc(sendEvent:)
    func sendEvent(_ command: CDVInvokedUrlCommand) {
        guard let name = required(command, "name") else { return }
        let opts = options(command)
        HeroSignal.Session.sendEvent(name, properties: opts["properties"] as? [String: Any] ?? [:], value: (opts["value"] as? NSNumber)?.doubleValue)
        ok(command)
    }

    // MARK: In-app

    @objc(addTriggers:)
    func addTriggers(_ command: CDVInvokedUrlCommand) { HeroSignal.InAppMessages.addTriggers(HeroSignalCordovaMapper.stringMap(options(command)["triggers"])); ok(command) }

    @objc(removeTriggers:)
    func removeTriggers(_ command: CDVInvokedUrlCommand) { HeroSignal.InAppMessages.removeTriggers(HeroSignalCordovaMapper.stringList(options(command)["keys"])); ok(command) }

    @objc(clearTriggers:)
    func clearTriggers(_ command: CDVInvokedUrlCommand) { HeroSignal.InAppMessages.clearTriggers(); ok(command) }

    @objc(getTriggers:)
    func getTriggers(_ command: CDVInvokedUrlCommand) { ok(command, ["triggers": HeroSignal.InAppMessages.getTriggers()]) }

    @objc(setScreen:)
    func setScreen(_ command: CDVInvokedUrlCommand) { HeroSignal.InAppMessages.setScreen(string(command, "name")); ok(command) }

    @objc(setInAppPaused:)
    func setInAppPaused(_ command: CDVInvokedUrlCommand) { HeroSignal.InAppMessages.paused = bool(command, "paused") ?? false; ok(command) }

    @objc(getInAppPaused:)
    func getInAppPaused(_ command: CDVInvokedUrlCommand) { ok(command, ["paused": HeroSignal.InAppMessages.paused]) }

    // MARK: Inbox

    /// Bildirim kutusu çağrısı: hata kodu `HSApiError.code`, geçersiz argüman `INVALID_ARGUMENT`, diğerleri `NOT_READY`.
    private func inbox(_ command: CDVInvokedUrlCommand, _ body: @escaping () async throws -> [String: Any]) {
        Task {
            do {
                self.ok(command, try await body())
            } catch let error as HSApiError {
                self.fail(command, code: error.code, message: error.message)
            } catch HSError.invalidArgument(let message) {
                self.fail(command, code: "INVALID_ARGUMENT", message: message)
            } catch {
                self.fail(command, code: "NOT_READY", message: "\(error)")
            }
        }
    }

    @objc(inboxList:)
    func inboxList(_ command: CDVInvokedUrlCommand) {
        let opts = options(command)
        let limit = (opts["limit"] as? NSNumber)?.intValue ?? 50
        let cursor = opts["cursor"] as? String
        inbox(command) { HeroSignalCordovaMapper.inboxPage(try await HeroSignal.Inbox.list(limit: limit, cursor: cursor)) }
    }

    @objc(inboxMarkRead:)
    func inboxMarkRead(_ command: CDVInvokedUrlCommand) {
        guard let id = required(command, "id") else { return }
        inbox(command) { ["item": HeroSignalCordovaMapper.inboxItem(try await HeroSignal.Inbox.markRead(id))] }
    }

    @objc(inboxMarkAllRead:)
    func inboxMarkAllRead(_ command: CDVInvokedUrlCommand) {
        inbox(command) { ["unreadCount": try await HeroSignal.Inbox.markAllRead()] }
    }

    @objc(inboxDelete:)
    func inboxDelete(_ command: CDVInvokedUrlCommand) {
        guard let id = required(command, "id") else { return }
        inbox(command) {
            try await HeroSignal.Inbox.archive(id)
            return [:]
        }
    }

    @objc(inboxUnreadCount:)
    func inboxUnreadCount(_ command: CDVInvokedUrlCommand) {
        inbox(command) { ["unreadCount": try await HeroSignal.Inbox.unreadCount()] }
    }

    // MARK: Debug

    @objc(setLogLevel:)
    func setLogLevel(_ command: CDVInvokedUrlCommand) { HeroSignal.Debug.setLogLevel(HeroSignalCordovaMapper.logLevel(string(command, "level"))); ok(command) }
}

/// JS ↔ SDK model ve argüman dönüşümleri (`types/index.d.ts` ile aynı alan adları).
enum HeroSignalCordovaMapper {
    static func logLevel(_ name: String?) -> HSLog.Level {
        switch name {
        case "none": return HSLog.Level.none
        case "error": return .error
        case "info": return .info
        case "debug": return .debug
        default: return .warn
        }
    }

    static func stringMap(_ raw: Any?) -> [String: String] {
        guard let dict = raw as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (key, value) in dict {
            switch value {
            case let s as String: out[key] = s
            case is NSNull: continue
            default: out[key] = "\(value)"
            }
        }
        return out
    }

    static func stringList(_ raw: Any?) -> [String] {
        (raw as? [Any] ?? []).compactMap { $0 as? String }
    }

    static func permission(_ status: UNAuthorizationStatus) -> [String: Any] {
        let name: String
        switch status {
        case .authorized, .ephemeral: name = "granted"
        case .provisional: name = "provisional"
        case .denied: name = "denied"
        case .notDetermined: name = "default"
        @unknown default: name = "default"
        }
        return ["granted": name == "granted" || name == "provisional", "status": name]
    }

    /// iOS'ta kaldırma kimliği teslimat kimliğidir (`removeNotification(id:)` `hs.dlv` ile de eşleşir).
    static func notification(_ n: HSNotification) -> [String: Any] {
        [
            "notificationId": n.deliveryId ?? NSNull(),
            "title": n.title ?? NSNull(),
            "body": n.body ?? NSNull(),
            "url": n.url ?? NSNull(),
            "imageUrl": n.imageUrl ?? NSNull(),
            "deliveryId": n.deliveryId ?? NSNull(),
            "messageId": n.messageId ?? NSNull(),
            "groupKey": NSNull(),
            "actions": n.actions.map { ["id": $0.id, "title": $0.title, "url": $0.url ?? NSNull()] as [String: Any] },
            "data": n.data,
        ]
    }

    static func subscription(_ s: HSPushSubscriptionState) -> [String: Any] {
        ["id": s.id ?? NSNull(), "token": s.token ?? NSNull(), "optedIn": s.optedIn]
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func iso(_ date: Date?) -> Any { date.map { isoFormatter.string(from: $0) } ?? NSNull() }

    static func inboxItem(_ item: HSInboxItem) -> [String: Any] {
        [
            "id": item.id, "messageId": item.messageId ?? NSNull(), "title": item.title ?? NSNull(), "body": item.body ?? NSNull(),
            "url": item.url ?? NSNull(), "imageUrl": item.imageUrl ?? NSNull(), "data": item.data, "read": item.read,
            "readAt": iso(item.readAt), "archivedAt": iso(item.archivedAt), "expiresAt": iso(item.expiresAt), "createdAt": iso(item.createdAt),
        ]
    }

    static func inboxPage(_ page: HSInboxPage) -> [String: Any] {
        ["items": page.items.map { inboxItem($0) }, "unreadCount": page.unreadCount, "nextCursor": page.nextCursor ?? NSNull(), "hasMore": page.hasMore]
    }
}
