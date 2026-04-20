import UIKit
import Foundation
import Capacitor
import WebKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Bumping this string forces a one-time native wipe of the shared
    // WKWebsiteDataStore (service workers, caches, cookies, local storage).
    // Required because the previous remote-URL builds registered a service
    // worker for app.ecologicc.com that can intercept requests and hang the
    // app on a loading spinner. JS-side cleanup runs too late — WKWebView
    // never reaches the JS if the SW is intercepting the navigation.
    private static let webDataWipeVersion = "ecologic-wipe-2026-04-17-v1"
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
    /// Synchronous flag write so the wipe can't run twice.
    private func wipeStaleWebDataIfNeeded() {
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: AppDelegate.webDataWipeKey) ?? ""
        if last == AppDelegate.webDataWipeVersion {
            NSLog("[AppDelegate] web data wipe already done for version %@", AppDelegate.webDataWipeVersion)
            return
        }
        NSLog("[AppDelegate] starting WKWebsiteDataStore wipe (version=%@, previous=%@)",
              AppDelegate.webDataWipeVersion, last.isEmpty ? "(none)" : last)

        let allTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        let store = WKWebsiteDataStore.default()
        let epoch = Date(timeIntervalSince1970: 0)
        store.removeData(ofTypes: allTypes, modifiedSince: epoch) {
            NSLog("[AppDelegate] WKWebsiteDataStore wipe COMPLETE — types=%d", allTypes.count)
        }

        // Mark as done immediately so we don't re-wipe on the next launch
        // even though the async wipe is still finishing in the background.
        defaults.set(AppDelegate.webDataWipeVersion, forKey: AppDelegate.webDataWipeKey)
        defaults.synchronize()
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
