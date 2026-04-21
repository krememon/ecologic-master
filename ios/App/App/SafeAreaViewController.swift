import UIKit
import Capacitor

class SafeAreaViewController: CAPBridgeViewController {

    /// Full-screen opaque white UIView pinned behind the WebView. Acts as the
    /// "page background" the user sees while WKWebView's WebContent process
    /// spins up, the network request to https://app.ecologicc.com is in
    /// flight, and the remote HTML is parsing — none of which are guaranteed
    /// to paint a background of their own. Without this view, that idle
    /// period falls through to the bridge VC's view (or worse, the window),
    /// which on a slow cold launch is exactly the black flash users were
    /// seeing.
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

    override func loadView() {
        super.loadView()
        // Earliest possible white paint, before viewDidLoad and before
        // Capacitor's CAPBridgeViewController base lifecycle adds the
        // WKWebView. The very first composited frame is now white.
        self.view.backgroundColor = .white
        self.overrideUserInterfaceStyle = .light
        NSLog("[SafeAreaVC] loadView — view.bg set white, style=light")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("[SafeAreaVC] viewDidLoad — class=%@", String(describing: type(of: self)))
        self.view.backgroundColor = .white

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
        // Combined with backgroundColor=.white, the visible result is always
        // white — never black.
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        webView.scrollView.indicatorStyle = .black
        // iOS 15+: underPageBackgroundColor controls the area exposed during
        // rubber-band scroll and the inter-page-load gap. Default is system
        // background → black in dark mode; force white.
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
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // Defensive: keep our background view at the bottom and the top
        // filler at the top of the z-order, even if any later subview
        // insertion (Capacitor, plugins, splash, etc.) reorders the
        // hierarchy.
        if webViewBackgroundView.superview === self.view {
            self.view.sendSubviewToBack(webViewBackgroundView)
        }
        if topSafeAreaBackgroundView.superview === self.view {
            self.view.bringSubviewToFront(topSafeAreaBackgroundView)
        }
        NSLog("[SafeAreaVC] viewDidLayoutSubviews — safeAreaInsets.top=%.1f fillerFrame=%@",
              self.view.safeAreaInsets.top,
              NSCoder.string(for: topSafeAreaBackgroundView.frame))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }
}
