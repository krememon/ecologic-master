import UIKit
import Foundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

  var window: UIWindow?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    NSLog("[APNS] didFinishLaunchingWithOptions CALLED")

    if let userActivityDict = launchOptions?[.userActivityDictionary] as? [String: Any],
       let userActivity = userActivityDict["UIApplicationLaunchOptionsUserActivityKey"] as? NSUserActivity,
       userActivity.activityType == NSUserActivityTypeBrowsingWeb,
       let url = userActivity.webpageURL {
      NSLog("[UniversalLink] cold start launch URL: %@", url.absoluteString)
    }

    return true
  }

  func application(_ application: UIApplication,
                   continue userActivity: NSUserActivity,
                   restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    NSLog("[UniversalLink] continue userActivity type=%@", userActivity.activityType)

    if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
       let url = userActivity.webpageURL {
      NSLog("[UniversalLink] incoming URL: %@", url.absoluteString)
    }

    return ApplicationDelegateProxy.shared.application(
      application, continue: userActivity, restorationHandler: restorationHandler
    )
  }

  func application(_ app: UIApplication, open url: URL,
                   options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    NSLog("[DeepLink] open URL: %@", url.absoluteString)
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
    NotificationCenter.default.post(name: .capacitorDidReceiveRemoteNotification, object: userInfo)
    completionHandler(.newData)
  }
}
