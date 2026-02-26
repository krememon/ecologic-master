import UIKit
import Capacitor

class SafeAreaViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        guard let webView = self.webView else { return }

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
