import Foundation
import HeroSignal
#if canImport(HeroSignalCore)
import HeroSignalCore
#endif
import ObjectiveC
import UIKit

/**
 Cordova uygulamalarında AppDelegate eklenti tarafından değiştirilemediğinden APNs token geri çağrıları çalışma
 zamanında AppDelegate sınıfına eklenir. Uygulama bu metotları zaten uyguluyorsa önce SDK'ya iletilir, ardından
 özgün uygulama çağrılır; uygulamıyorsa yalnızca SDK'ya iletilir. Bir kez kurulur.
 */
enum HeroSignalAppDelegateHook {
    private static var installed = false

    private typealias TokenImp = @convention(c) (AnyObject, Selector, UIApplication, NSData) -> Void
    private typealias ErrorImp = @convention(c) (AnyObject, Selector, UIApplication, NSError) -> Void

    static func install() {
        guard !installed, let delegate = UIApplication.shared.delegate else { return }
        installed = true
        let cls: AnyClass = type(of: delegate)

        let tokenSelector = #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:))
        let originalToken = class_getInstanceMethod(cls, tokenSelector).map { unsafeBitCast(method_getImplementation($0), to: TokenImp.self) }
        let tokenBlock: @convention(block) (AnyObject, UIApplication, NSData) -> Void = { receiver, application, token in
            HeroSignal.setDeviceToken(token as Data)
            originalToken?(receiver, tokenSelector, application, token)
        }
        replace(cls, tokenSelector, imp_implementationWithBlock(tokenBlock))

        let errorSelector = #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:))
        let originalError = class_getInstanceMethod(cls, errorSelector).map { unsafeBitCast(method_getImplementation($0), to: ErrorImp.self) }
        let errorBlock: @convention(block) (AnyObject, UIApplication, NSError) -> Void = { receiver, application, error in
            HeroSignal.setDeviceTokenError(error)
            originalError?(receiver, errorSelector, application, error)
        }
        replace(cls, errorSelector, imp_implementationWithBlock(errorBlock))

        // UIKit delegenin yanıtladığı seçicileri atama anında önbelleğe alır; yeni metotların görülmesi için yeniden atanır.
        let application = UIApplication.shared
        application.delegate = nil
        application.delegate = delegate
    }

    /// Sınıfın kendisinde metot yoksa eklenir (üst sınıf uygulaması `original` ile çağrılır), varsa değiştirilir.
    private static func replace(_ cls: AnyClass, _ selector: Selector, _ imp: IMP) {
        let types = "v@:@@"
        if !class_addMethod(cls, selector, imp, types), let method = class_getInstanceMethod(cls, selector) {
            method_setImplementation(method, imp)
        }
    }
}
