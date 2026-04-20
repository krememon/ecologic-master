import UIKit
import Capacitor

class SafeAreaViewController: CAPBridgeViewController {

    /// Explicit opaque white UIView pinned to the top of self.view down to the
    /// safe-area top anchor. This is the strip behind the iOS status bar
    /// (time / Wi-Fi / battery). We add a real view in the native hierarchy
    /// rather than relying on background colors of self.view / window /
    /// webview, because in practice those have been getting overpainted or
    /// ignored at runtime, leaving a black strip behind the status bar.
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
        // Run BEFORE viewDidLoad and BEFORE Capacitor's CAPBridgeViewController
        // base lifecycle adds the WKWebView. By forcing the root view to white
        // here, the very first frame the window composites already has a
        // white background — eliminating the split-second black flash that
        // appears when the storyboard-default view (systemBackground → black
        // in dark mode) is briefly visible during launch.
        super.loadView()
        self.view.backgroundColor = .white
        self.overrideUserInterfaceStyle = .light
        NSLog("[SafeAreaVC] loadView — view.bg set white, style=light")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("[SafeAreaVC] viewDidLoad — class=%@", String(describing: type(of: self)))

        // Force the bridge VC's own view white as a baseline.
        self.view.backgroundColor = .white

        guard let webView = self.webView else {
            NSLog("[SafeAreaVC] WARNING: webView is nil in viewDidLoad")
            return
        }

        // Make the WebView itself opaque white so there's no transparency
        // anywhere along the top edge while content paints.
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white

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

        // Add the explicit white filler view ABOVE the webview in z-order so
        // nothing the webview or bridge does can paint over the status-bar
        // strip. Adding it as a subview of self.view (NOT of the webview)
        // means it lives outside Capacitor's WKWebView surface entirely.
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
        // Defensive: keep our filler at the top of the z-order even if any
        // later subview insertion (Capacitor, plugins, splash, etc.) reorders
        // the hierarchy. Cheap idempotent call.
        if topSafeAreaBackgroundView.superview === self.view {
            self.view.bringSubviewToFront(topSafeAreaBackgroundView)
        }
        NSLog("[SafeAreaVC] viewDidLayoutSubviews — safeAreaInsets.top=%.1f fillerFrame=%@",
              self.view.safeAreaInsets.top,
              NSCoder.string(for: topSafeAreaBackgroundView.frame))
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        // Dark icons/text on our white status-bar strip. The Capacitor
        // StatusBar plugin's runtime setStyle({Style.Light}) call also reaches
        // this controller, but returning .darkContent here guarantees the
        // correct style on the very first frame, before JS runs.
        return .darkContent
    }
}
