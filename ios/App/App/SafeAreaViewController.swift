import UIKit
import Capacitor

class SafeAreaViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        // Paint the bridge view controller's view white. This is the surface
        // that shows through above the WebView when we pin the WebView to the
        // safe-area top anchor (below). Without this, that strip falls through
        // to the UIWindow background (black by default) — which is exactly the
        // black status-bar strip users were seeing.
        self.view.backgroundColor = .white

        guard let webView = self.webView else { return }

        // Make the WebView itself opaque white so there is no transparent area
        // anywhere — covers any frame the WebView paints during layout.
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white

        webView.translatesAutoresizingMaskIntoConstraints = false

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
    }
}
