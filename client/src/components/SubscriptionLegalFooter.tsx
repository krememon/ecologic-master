import { Link } from "wouter";

interface SubscriptionLegalFooterProps {
  nativeIos?: boolean;
  nativeAndroid?: boolean;
  className?: string;
}

export function SubscriptionLegalFooter({
  nativeIos = false,
  nativeAndroid = false,
  className = "",
}: SubscriptionLegalFooterProps) {
  const isNative = nativeIos || nativeAndroid;
  const store = nativeIos ? "App Store" : nativeAndroid ? "Google Play" : null;

  return (
    <div className={`text-center space-y-2 ${className}`}>
      <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
        {isNative
          ? `Monthly auto-renewing subscription. Cancel at least 24 hours before renewal to avoid charges. Manage or cancel anytime in ${store ?? "account"} Settings.`
          : "Subscriptions auto-renew monthly at the listed price unless canceled before the renewal date. Manage or cancel anytime in billing settings."}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Access to EcoLogic's paid features requires an active subscription.
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        <Link
          href="/privacy"
          className="text-blue-500 hover:underline"
        >
          Privacy Policy
        </Link>
        {" · "}
        <Link
          href="/terms"
          className="text-blue-500 hover:underline"
        >
          Terms of Use
        </Link>
      </p>
    </div>
  );
}
