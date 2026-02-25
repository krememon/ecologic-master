import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

  var window: UIWindow?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    print("[APNS] didFinishLaunchingWithOptions called")
    return true
  }

  func application(_ application: UIApplication,
                   didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let tokenString = deviceToken.map { String(format: "%02x", $0) }.joined()
    print("[APNS] didRegisterForRemoteNotificationsWithDeviceToken CALLED. bytes=\(deviceToken.count) token=\(tokenString)")
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
  }

  func application(_ application: UIApplication,
                   didFailToRegisterForRemoteNotificationsWithError error: Error) {
    print("[APNS] didFailToRegisterForRemoteNotificationsWithError:", error.localizedDescription, "full:", error)
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
  }

  func application(_ application: UIApplication,
                   didReceiveRemoteNotification userInfo: [AnyHashable : Any],
                   fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    print("[APNS] didReceiveRemoteNotification:", userInfo)
    NotificationCenter.default.post(name: .capacitorDidReceiveRemoteNotification, object: userInfo)
    completionHandler(.newData)
  }
}
