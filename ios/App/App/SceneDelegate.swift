import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        NSLog("[SceneDelegate] scene willConnectTo called")

        for userActivity in connectionOptions.userActivities {
            NSLog("[SceneDelegate] cold-start userActivity type=%@", userActivity.activityType)
            if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
               let url = userActivity.webpageURL {
                NSLog("[SceneDelegate] cold-start universal link: %@", url.absoluteString)
                _ = ApplicationDelegateProxy.shared.application(
                    UIApplication.shared,
                    continue: userActivity,
                    restorationHandler: { _ in }
                )
            }
        }

        for urlContext in connectionOptions.urlContexts {
            NSLog("[SceneDelegate] cold-start URL context: %@", urlContext.url.absoluteString)
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: urlContext.url,
                options: [:]
            )
        }

        guard let windowScene = scene as? UIWindowScene else {
            NSLog("[SceneDelegate] scene is not UIWindowScene")
            return
        }

        let window = UIWindow(windowScene: windowScene)
        // Belt-and-suspenders: the UIWindow is the bottommost surface on screen.
        // If anything above it is ever transparent, this is what shows through.
        // Default is black on iOS — which produced the black status-bar strip.
        window.backgroundColor = .white

        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        if let vc = storyboard.instantiateInitialViewController() {
            // Force the root VC's view white as well, in case the storyboard
            // VC isn't our SafeAreaViewController (e.g. during a future swap).
            vc.view.backgroundColor = .white
            window.rootViewController = vc
        }

        self.window = window
        window.makeKeyAndVisible()

        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            appDelegate.window = window
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        NSLog("[SceneDelegate] scene continue userActivity type=%@", userActivity.activityType)

        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            NSLog("[SceneDelegate] warm universal link: %@", url.absoluteString)
        }

        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            NSLog("[SceneDelegate] openURLContext: %@", context.url.absoluteString)
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: context.url,
                options: [:]
            )
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {}
    func sceneWillResignActive(_ scene: UIScene) {}
    func sceneWillEnterForeground(_ scene: UIScene) {}
    func sceneDidEnterBackground(_ scene: UIScene) {}
}
