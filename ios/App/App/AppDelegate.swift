import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // WRAPPER BADGE: Set to false to hide the debug overlay
    private let showWrapperBadge = true

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if showWrapperBadge {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.addWrapperBadge()
            }
        }
        return true
    }

    private func addWrapperBadge() {
        guard let window = self.window else { return }

        let badge = UILabel()
        badge.text = "WRAPPER"
        badge.font = UIFont.systemFont(ofSize: 10, weight: .bold)
        badge.textColor = .white
        badge.backgroundColor = UIColor(red: 0.1, green: 0.5, blue: 0.39, alpha: 0.85)
        badge.textAlignment = .center
        badge.layer.cornerRadius = 10
        badge.clipsToBounds = true
        badge.translatesAutoresizingMaskIntoConstraints = false

        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.isUserInteractionEnabled = false
        container.addSubview(badge)

        window.addSubview(container)

        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor, constant: 2),
            container.centerXAnchor.constraint(equalTo: window.centerXAnchor),
            badge.topAnchor.constraint(equalTo: container.topAnchor),
            badge.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            badge.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            badge.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            badge.widthAnchor.constraint(equalToConstant: 72),
            badge.heightAnchor.constraint(equalToConstant: 20),
        ])

        window.bringSubviewToFront(container)
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: .capacitorDidReceiveRemoteNotification, object: userInfo)
        completionHandler(.newData)
    }

}
