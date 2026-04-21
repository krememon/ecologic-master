import UIKit
import Capacitor

class SafeAreaViewController: CAPBridgeViewController {

    /// Full-screen opaque white UIView pinned behind the WebView. Acts as the
    /// "page background" the user sees while WKWebView's WebContent process
    /// spins up, the network request to https://app.ecologicc.com is in
    /// flight, and the remote HTML is parsing — none of which are guaranteed
    /// to paint a background of their own.
    private let webViewBackgroundView: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = .white
        v.isOpaque = true
        v.isUserInteractionEnabled = false
        v.accessibilityIdentifier = "EcoLogicWebViewBackground"
        return v
    }()

    /// Explicit opaque white UIView pinned to the top of self.view down to the
    /// safe-area top anchor. This is the strip behind the iOS status bar
    /// (time / Wi-Fi / battery). Stays in front of everything else.
    private let topSafeAreaBackgroundView: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = .white
        v.isOpaque = true
        v.isUserInteractionEnabled = false
        v.accessibilityIdentifier = "EcoLogicTopSafeAreaBackground"
        return v
    }()

    /// One-time guard so the topSafeAreaBackgroundView setup (which used to
    /// live in loadView()) only runs once during the first viewDidLoad pass.
    private var didInstallBackgrounds = false

    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("[SafeAreaVC] viewDidLoad — class=%@", String(describing: type(of: self)))

        // Earliest white paint we can do without overriding loadView (which is
        // marked non-open / final in the current CAPBridgeViewController and
        // produced "Overriding non-open instance method outside of its
        // defining module" errors). viewDidLoad still fires before the view
        // is added to the window, so the first composited frame is white.
        self.view.backgroundColor = .white
        self.overrideUserInterfaceStyle = .light

        guard let webView = self.webView else {
            NSLog("[SafeAreaVC] WARNING: webView is nil in viewDidLoad")
            return
        }

        // Insert the full-screen white background view BEHIND the webview in
        // z-order. Doing this on self.view (which already contains the
        // webview as a subview at this point) and then sending it to back
        // guarantees the webview composites on top of white, never on top of
        // a darker UIWindow surface.
        self.view.insertSubview(webViewBackgroundView, at: 0)
        NSLayoutConstraint.activate([
            webViewBackgroundView.topAnchor.constraint(equalTo: self.view.topAnchor),
            webViewBackgroundView.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
            webViewBackgroundView.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
            webViewBackgroundView.bottomAnchor.constraint(equalTo: self.view.bottomAnchor),
        ])
        NSLog("[SafeAreaVC] webViewBackgroundView added behind WKWebView")

        // WebView background config. isOpaque=false lets the white
        // webViewBackgroundView underneath show through any transparent
        // pixels during the WebContent process startup / first paint window.
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.indicatorStyle = .black
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = .white
        }

        webView.translatesAutoresizingMaskIntoConstraints = false

        // Strip Capacitor's default top constraint on the webview so we can
        // re-pin it to the safe area below.
        webView.constraints.forEach { constraint in
            if constraint.firstAttribute == .top || constraint.secondAttribute == .top {
                webView.removeConstraint(constraint)
            }
        }
        if let superview = webView.superview {
            superview.constraints.forEach { constraint in
                let involvesWebView = constraint.firstItem === webView || constraint.secondItem === webView
                let involvesTop = constraint.firstAttribute == .top || constraint.secondAttribute == .top
                if involvesWebView && involvesTop {
                    superview.removeConstraint(constraint)
                }
            }

            NSLayoutConstraint.activate([
                webView.topAnchor.constraint(equalTo: superview.safeAreaLayoutGuide.topAnchor),
                webView.bottomAnchor.constraint(equalTo: superview.bottomAnchor),
                webView.leadingAnchor.constraint(equalTo: superview.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: superview.trailingAnchor),
            ])
        }

        // Add the top-safe-area filler ABOVE the webview in z-order.
        self.view.addSubview(topSafeAreaBackgroundView)
        self.view.bringSubviewToFront(topSafeAreaBackgroundView)
        NSLayoutConstraint.activate([
            topSafeAreaBackgroundView.topAnchor.constraint(equalTo: self.view.topAnchor),
            topSafeAreaBackgroundView.leadingAnchor.constraint(equalTo: self.view.leadingAnchor),
            topSafeAreaBackgroundView.trailingAnchor.constraint(equalTo: self.view.trailingAnchor),
            topSafeAreaBackgroundView.bottomAnchor.constraint(equalTo: self.view.safeAreaLayoutGuide.topAnchor),
        ])
        NSLog("[SafeAreaVC] topSafeAreaBackgroundView added (white, opaque)")

        didInstallBackgrounds = true
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Keep our background views correctly z-ordered even if any later
        // subview insertion (Capacitor, plugins, splash, etc.) reorders the
        // hierarchy. Cheap idempotent calls.
        if webViewBackgroundView.superview === self.view {
            self.view.sendSubviewToBack(webViewBackgroundView)
        }
        if topSafeAreaBackgroundView.superview === self.view {
            self.view.bringSubviewToFront(topSafeAreaBackgroundView)
        }
        // Belt-and-suspenders: ensure the root view background never reverts
        // to a system color on a layout pass.
        self.view.backgroundColor = .white
        NSLog("[SafeAreaVC] viewDidLayoutSubviews — safeAreaInsets.top=%.1f fillerFrame=%@",
              self.view.safeAreaInsets.top,
              NSCoder.string(for: topSafeAreaBackgroundView.frame))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        // Dark icons/text on our white status-bar strip.
        return .darkContent
    }
}
