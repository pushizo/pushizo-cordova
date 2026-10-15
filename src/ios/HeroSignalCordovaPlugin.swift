#if canImport(Cordova)
import Cordova
#endif
import Foundation
import HeroSignal
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import UIKit

/**
 Cordova → HeroSignal iOS SDK köprüsü (`cordova.exec` servisi "HeroSignal", `onload` ile uygulama açılışında
 yüklenir). Metotlar `HeroSignalBridgeCore` üzerinden SDK'ya iletilir. SDK olayları JS'in `setEventCallback`
 ile açtığı tek `keepCallback` kanalından `{ type, payload }` olarak gönderilir; kanal açılmadan gelen olaylar
 tamponlanır. APNs token geri çağrıları `HeroSignalAppDelegateHook` ile yakalanır.
 */
@objc(HeroSignalCordovaPlugin)
class HeroSignalCordovaPlugin: CDVPlugin {
    // CDVCommandStatus üye adları cordova-ios sürümleri arasında farklı (Swift adı); ham değerler sabittir.
    private static let statusNoResult = CDVCommandStatus(rawValue: 0)!
    private static let statusOk = CDVCommandStatus(rawValue: 1)!
    private static let statusError = CDVCommandStatus(rawValue: 9)!
    private static let maxBufferedEvents = 50

    private var core: HeroSignalBridgeCore!
    private var eventCallbackId: String?
    private var bufferedEvents: [[String: Any]] = []

    override func pluginInitialize() {
        super.pluginInitialize()
        core = HeroSignalBridgeCore { [weak self] type, payload in
            DispatchQueue.main.async { self?.sendEvent(["type": type, "payload": payload]) }
        }
        HeroSignalAppDelegateHook.install()
        // Daha önce JS ile başlatıldıysa SDK hemen kayıtlı ayarlarla başlatılır; bildirimden açılış tıklaması kaybolmaz.
        if !HeroSignal.isInitialized, let config = HeroSignalBridgeConfig.load() {
            config.initializeSdk()
        }
        core.attachIfInitialized()
    }

    override func onReset() {
        // Sayfa yeniden yüklendi: eski JS kanalı geçersiz; yeni sayfa `setEventCallback` ile yeniden açar.
        eventCallbackId = nil
        core.foregroundHandlerEnabled = false
    }

    // MARK: Olay kanalı

    @objc(setEventCallback:) func setEventCallback(_ command: CDVInvokedUrlCommand) {
        eventCallbackId = command.callbackId
        let opened = CDVPluginResult(status: Self.statusNoResult)
        opened?.setKeepCallbackAs(true)
        commandDelegate.send(opened, callbackId: command.callbackId)
        let buffered = bufferedEvents
        bufferedEvents.removeAll()
        buffered.forEach { sendEvent($0) }
    }

    /// Ana iş parçacığında çağrılır.
    private func sendEvent(_ message: [String: Any]) {
        guard let callbackId = eventCallbackId else {
            bufferedEvents.append(message)
            if bufferedEvents.count > Self.maxBufferedEvents { bufferedEvents.removeFirst(bufferedEvents.count - Self.maxBufferedEvents) }
            return
        }
        let result = CDVPluginResult(status: Self.statusOk, messageAs: message)
        result?.setKeepCallbackAs(true)
        commandDelegate.send(result, callbackId: callbackId)
    }

    // MARK: Metotlar

    private func dispatch(_ command: CDVInvokedUrlCommand) {
        let args = command.argument(at: 0) as? [String: Any] ?? [:]
        let callbackId = command.callbackId
        let handled = core.handle(command.methodName ?? "", args) { [weak self] result in
            guard let self else { return }
            let pluginResult: CDVPluginResult?
            switch result {
            case .success(let data):
                pluginResult = data.map { CDVPluginResult(status: Self.statusOk, messageAs: $0) } ?? CDVPluginResult(status: Self.statusOk)
            case .failure(let code, let message):
                pluginResult = CDVPluginResult(status: Self.statusError, messageAs: ["code": code, "message": message])
            }
            self.commandDelegate.send(pluginResult, callbackId: callbackId)
        }
        if !handled {
            let error = CDVPluginResult(status: Self.statusError, messageAs: ["code": "NOT_IMPLEMENTED", "message": "HeroSignal: \(command.methodName ?? "") desteklenmiyor"])
            commandDelegate.send(error, callbackId: callbackId)
        }
    }

    @objc(initialize:) func initializeSdk(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setConsentGiven:) func setConsentGiven(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(login:) func login(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(updateUserJwt:) func updateUserJwt(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(logout:) func logout(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(addTags:) func addTags(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeTags:) func removeTags(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getTags:) func getTags(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(addAliases:) func addAliases(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeAlias:) func removeAlias(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setLanguage:) func setLanguage(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(addEmail:) func addEmail(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeEmail:) func removeEmail(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(addSms:) func addSms(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeSms:) func removeSms(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getUser:) func getUser(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getContacts:) func getContacts(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getPreferences:) func getPreferences(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setPreferences:) func setPreferences(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getPushSubscription:) func getPushSubscription(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(optIn:) func optIn(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(optOut:) func optOut(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getPermission:) func getPermission(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(requestPermission:) func requestPermission(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(clearAll:) func clearAll(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeNotification:) func removeNotification(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeGroupedNotifications:) func removeGroupedNotifications(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setForegroundHandlerEnabled:) func setForegroundHandlerEnabled(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(displayNotification:) func displayNotification(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(sendEvent:) func sendEvent(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setLogLevel:) func setLogLevel(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(addTriggers:) func addTriggers(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(removeTriggers:) func removeTriggers(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(clearTriggers:) func clearTriggers(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getTriggers:) func getTriggers(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setScreen:) func setScreen(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setInAppPaused:) func setInAppPaused(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(getInAppPaused:) func getInAppPaused(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(inboxList:) func inboxList(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(inboxMarkRead:) func inboxMarkRead(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(inboxMarkAllRead:) func inboxMarkAllRead(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(inboxArchive:) func inboxArchive(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(inboxUnreadCount:) func inboxUnreadCount(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(setupDefaultLiveActivity:) func setupDefaultLiveActivity(_ command: CDVInvokedUrlCommand) { dispatch(command) }
    @objc(startDefaultLiveActivity:) func startDefaultLiveActivity(_ command: CDVInvokedUrlCommand) { dispatch(command) }
}
