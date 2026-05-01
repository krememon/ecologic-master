import UIKit
import Foundation
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Bumping this string forces a one-time native wipe of the shared
    // WKWebsiteDataStore (service workers, caches, cookies, local storage).
    //
    // WHY THIS EXISTS:
    //   WKWebView maintains its own HTTP disk cache independently of any JS
    //   code.  When the staging.ecologicc.com bundle is redeployed, WKWebView
    //   may continue serving the previous cached index.html (and therefore
    //   the previous JS chunks) because express.static's ETag support is
    //   disabled and WKWebView does not always honour max-age=0 for resources
    //   it already has in its persistent disk cache.  JS-side cache-clearing
    //   cannot help here because the old JS is the code that runs.
    //
    // Bump this string to force a new wipe on the next native launch:
    //   ecologic-wipe-2026-04-17-v1  ← cleared stale service-worker from web build
    //   ecologic-wipe-2026-04-29-appsflyer-v2  ← clears bundle cached before AppsFlyer Phase 2 diagnostic deploy
    //   ecologic-wipe-2026-04-29-appsflyer-v3  ← force-reload after appsflyer.ts availability-gate rewrite
    private static let webDataWipeVersion = "ecologic-wipe-2026-04-29-appsflyer-v3"
    private static let webDataWipeKey     = "EcoLogicLastWebDataWipe"

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NSLog("[AppDelegate] didFinishLaunchingWithOptions CALLED")
        // Defensive: if the window already exists at this point (rare with
        // scene-based apps, but possible on older iOS or restoration paths),
        // make sure its background is white so no black surface can show
        // through behind the status bar.
        self.window?.backgroundColor = .white
        self.window?.overrideUserInterfaceStyle = .light

        // Proof-of-config logs — Info.plist value + window state on cold
        // start, so a quick Xcode console scan confirms the early-frame
        // white/light path is actually being hit.
        let plistStyle = Bundle.main.object(forInfoDictionaryKey: "UIUserInterfaceStyle") as? String ?? "(missing)"
        NSLog("[AppDelegate] PROOF Info.plist UIUserInterfaceStyle=%@", plistStyle)
        if let w = self.window {
            NSLog("[AppDelegate] PROOF self.window present — bg=%@ style=%ld",
                  w.backgroundColor?.description ?? "(nil)",
                  w.overrideUserInterfaceStyle.rawValue)
        } else {
            NSLog("[AppDelegate] PROOF self.window nil at didFinishLaunchingWithOptions (expected for scene-based apps)")
        }

        wipeStaleWebDataIfNeeded()
        logStartupDiagnostics()

        if let userActivityDict = launchOptions?[.userActivityDictionary] as? [String: Any],
           let userActivity = userActivityDict["UIApplicationLaunchOptionsUserActivityKey"] as? NSUserActivity,
           userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            NSLog("[AppDelegate] cold start universal link in launchOptions: %@", url.absoluteString)
        }

        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        NSLog("[AppDelegate] configurationForConnecting called")

        for userActivity in options.userActivities {
            if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
               let url = userActivity.webpageURL {
                NSLog("[AppDelegate] configurationForConnecting universal link: %@", url.absoluteString)
            }
        }

        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    func application(_ application: UIApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        NSLog("[AppDelegate] continue userActivity type=%@", userActivity.activityType)

        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            NSLog("[AppDelegate] universal link (AppDelegate fallback): %@", url.absoluteString)
        }

        return ApplicationDelegateProxy.shared.application(
            application, continue: userActivity, restorationHandler: restorationHandler
        )
    }

    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        NSLog("[AppDelegate] open URL: %@", url.absoluteString)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02x", $0) }.joined()
        NSLog("[APNS] didRegisterForRemoteNotificationsWithDeviceToken CALLED bytes=%d token=%@", deviceToken.count, tokenString)
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("[APNS] didFailToRegisterForRemoteNotificationsWithError %@", String(describing: error))
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable : Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NSLog("[APNS] didReceiveRemoteNotification %@", String(describing: userInfo))
        NotificationCenter.default.post(name: NSNotification.Name(rawValue: "Capacitor.didReceiveRemoteNotification"), object: userInfo)
        completionHandler(.newData)
    }

    // MARK: - WKWebView stale-data wipe + startup diagnostics

    /// One-time wipe of the shared WKWebsiteDataStore. Runs once per
    /// `webDataWipeVersion` value — bump that constant to force a re-wipe.
    ///
    /// The wipe is made SYNCHRONOUS via DispatchSemaphore so that the
    /// WKWebView HTTP disk cache is guaranteed empty *before* Capacitor
    /// creates the WKWebView and starts loading staging.ecologicc.com.
    /// The async version had a race: removeData fires in the background,
    /// didFinishLaunchingWithOptions returns, the scene is set up, the
    /// WKWebView is created and begins its first HTTP fetch — all before the
    /// wipe callback fires.  That means the first load after a version bump
    /// still hit the stale cache.
    ///
    /// WKWebsiteDataStore.allWebsiteDataTypes() covers:
    ///   • WKWebsiteDataTypeDiskCache          ← JS/CSS/image HTTP cache
    ///   • WKWebsiteDataTypeMemoryCache        ← in-process response cache
    ///   • WKWebsiteDataTypeCookies
    ///   • WKWebsiteDataTypeSessionStorage
    ///   • WKWebsiteDataTypeLocalStorage
    ///   • WKWebsiteDataTypeIndexedDBDatabases
    ///   • WKWebsiteDataTypeServiceWorkerRegistrations
    ///   • WKWebsiteDataTypeOfflineWebApplicationCache
    ///   (and any future types Apple adds)
    private func wipeStaleWebDataIfNeeded() {
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: AppDelegate.webDataWipeKey) ?? ""
        if last == AppDelegate.webDataWipeVersion {
            NSLog("[AppDelegate] web data wipe already done for version %@", AppDelegate.webDataWipeVersion)
            return
        }

        NSLog("[AppDelegate] forcing web data wipe for version %@ (previous: %@)",
              AppDelegate.webDataWipeVersion, last.isEmpty ? "(none)" : last)

        let allTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        let store    = WKWebsiteDataStore.default()
        let epoch    = Date(timeIntervalSince1970: 0)

        // We need the wipe to finish BEFORE Capacitor creates the WKWebView.
        // removeData's completion handler is dispatched to the main queue, so
        // we CANNOT block the main thread (Thread.sleep / semaphore.wait on
        // the main thread → deadlock because the callback can never fire).
        //
        // Correct pattern: spin the main RunLoop in .default mode.  This
        // processes pending main-queue work (including the removeData callback)
        // while still preventing wipeStaleWebDataIfNeeded() from returning
        // until the wipe is truly done.  A 3-second safety timeout ensures
        // the app starts even if the wipe hangs for any reason.
        var wipeDone = false
        store.removeData(ofTypes: allTypes, modifiedSince: epoch) {
            NSLog("[AppDelegate] web data wipe complete (types=%d cleared)", allTypes.count)
            wipeDone = true
        }
        let deadline = Date(timeIntervalSinceNow: 3.0)
        while !wipeDone && Date() < deadline {
            RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
        if !wipeDone {
            NSLog("[AppDelegate] web data wipe WARNING — timed out after 3 s, proceeding anyway")
        }

        defaults.set(AppDelegate.webDataWipeVersion, forKey: AppDelegate.webDataWipeKey)
        defaults.synchronize()
        NSLog("[AppDelegate] web data wipe flag persisted — will not re-wipe until version is bumped")
    }

    /// Print resolved server URL + native flag for diagnosis.
    private func logStartupDiagnostics() {
        let bundlePath = Bundle.main.path(forResource: "capacitor.config", ofType: "json")
        var serverUrl = "(not found)"
        if let path = bundlePath,
           let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let server = json["server"] as? [String: Any] {
                serverUrl = (server["url"] as? String) ?? "(server.url missing → bundled mode)"
            } else {
                serverUrl = "(server block missing → bundled mode)"
            }
        }
        NSLog("[AppDelegate] STARTUP isNative=true serverUrl=%@", serverUrl)
        NSLog("[AppDelegate] STARTUP bundleId=%@", Bundle.main.bundleIdentifier ?? "(unknown)")
    }
}
