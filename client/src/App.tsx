import * as React from "react";
import { Capacitor } from "@capacitor/core";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Layout from "@/components/Layout";
import DashboardApp from "@/dashboard/DashboardApp";
import { getAppMode } from "@/dashboard/lib/host";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useSubscriptionGate } from "@/hooks/useSubscriptionGate";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import AuthPage from "@/pages/auth-page";
import Auth from "@/pages/Auth";
import Home from "@/pages/Home";
import Jobs from "@/pages/Jobs";
import Contractors from "@/pages/Contractors";
import Clients from "@/pages/Clients";
import Invoicing from "@/pages/Invoicing";
import Documents from "@/pages/Documents";
import MessagesDirectory from "@/pages/MessagesDirectory";
import MessageThread from "@/pages/MessageThread";
import PaymentsPage from "@/pages/payments-page";
import AIScheduling from "@/pages/AIScheduling";
import Settings from "@/pages/Settings";
import StripeConnectSettings from "@/pages/StripeConnectSettings";
import Approvals from "@/pages/Approvals";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import ChoosePlan from "@/pages/ChoosePlan";
import Employees from "@/pages/Employees";
import JoinCompany from "@/pages/JoinCompany";
import Customize from "@/pages/Customize";
import PriceBook from "@/pages/PriceBook";
import CompanyProfile from "@/pages/CompanyProfile";
import Taxes from "@/pages/Taxes";
import IndustryOnboarding from "@/pages/IndustryOnboarding";
import EstimateDetails from "@/pages/EstimateDetails";
import InvoiceDetails from "@/pages/InvoiceDetails";
import JobDetails from "@/pages/JobDetails";
import JobEdit from "@/pages/JobEdit";
import ClientDetail from "@/pages/ClientDetail";
import ContractorDetail from "@/pages/ContractorDetail";
import PaymentReview from "@/pages/PaymentReview";
import PublicInvoicePay from "@/pages/PublicInvoicePay";
import CampaignResponsePage from "@/pages/CampaignResponsePage";
import Leads from "@/pages/Leads";
import LeadDetails from "@/pages/LeadDetails";
import Timesheets from "@/pages/Timesheets";
import TimeTrackingSettings from "@/pages/TimeTrackingSettings";
import EstimateSettings from "@/pages/EstimateSettings";
import PaymentSettings from "@/pages/PaymentSettings";
import EmailBranding from "@/pages/EmailBranding";
import QuickBooksSettings from "@/pages/QuickBooksSettings";
import FinancialConnections from "@/pages/FinancialConnections";
import PaymentDetails from "@/pages/payment-details";
import InvoicePaymentDetails from "@/pages/invoice-payment-details";
import RefundScreen from "@/pages/refund-screen";
import RefundOtherMethod from "@/pages/refund-other-method";
import PublicUnsubscribe from "@/pages/PublicUnsubscribe";
import Legal from "@/pages/Legal";
import TermsOfService from "@/pages/TermsOfService";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import About from "@/pages/About";
import Support from "@/pages/Support";
import ContactSupport from "@/pages/ContactSupport";
import ReportBug from "@/pages/ReportBug";
import RequestFeature from "@/pages/RequestFeature";
import FAQs from "@/pages/FAQs";
import SignupWizard from "@/pages/SignupWizard";
import Welcome from "@/pages/Welcome";
import SignInWizard from "@/pages/SignInWizard";
import OnboardingChoice from "@/pages/OnboardingChoice";
import DevTools from "@/pages/DevTools";
import OnboardingCompany from "@/pages/OnboardingCompany";
import OnboardingSubscription from "@/pages/OnboardingSubscription";
import Paywall from "@/pages/Paywall";
import Billing from "@/pages/Billing";
import BillingSuccess from "@/pages/BillingSuccess";
import DemoCreateJob from "@/pages/DemoCreateJob";
import PayoutSetup from "@/pages/PayoutSetup";
import JobOfferInvite from "@/pages/JobOfferInvite";
import JobOffer from "@/pages/JobOffer";
import UpgradePlan from "@/pages/UpgradePlan";

// Static top-level import so that both the deep-link path (appUrlOpen /
// handleAuthCallbackUrl) and the polling path (startGoogleAuthNative interval)
// share the EXACT same module instance and therefore the same _inFlightCodes
// Set and _authHandled boolean.  A dynamic await import() is cached by the
// module loader but the cache lookup itself takes a microtask tick — wide
// enough for the poll to win the Set.add() race before the deep-link path
// even reaches the guard.
import {
  isNativePlatform,
  getPlatform,
  closeSystemBrowser,
  stopPolling,
  exchangeNativeAuthCode,
  PROCESSED_LAUNCH_URL_KEY,
} from "@/lib/capacitor";

let _nativeLaunchUrlChecked = false;
let _nativeLaunchUrlPromise: Promise<void> | null = null;

function checkLaunchDeepLink(): void {
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const platform = cap.getPlatform?.();
    if (!platform || platform === "web") return;

    const currentPath = window.location.pathname;
    const invitePathMatch = currentPath.match(/^\/invite\/referral\/([a-zA-Z0-9]+)/);
    if (invitePathMatch) {
      sessionStorage.setItem("pendingDeepLink", `/referrals/invite/${invitePathMatch[1]}`);
      _nativeLaunchUrlChecked = true;
      return;
    }

    const referralsMatch = currentPath.match(/^\/referrals\/invite\/([a-zA-Z0-9]+)/);
    if (referralsMatch) {
      sessionStorage.setItem("pendingDeepLink", currentPath);
      _nativeLaunchUrlChecked = true;
      return;
    }

    const jobOfferMatch = currentPath.match(/^\/job-offer\/\d+\/([a-zA-Z0-9]+)/);
    if (jobOfferMatch) {
      sessionStorage.setItem("pendingDeepLink", `/referrals/invite/${jobOfferMatch[1]}`);
      _nativeLaunchUrlChecked = true;
      return;
    }

    _nativeLaunchUrlPromise = (async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        const launchUrl = await CapApp.getLaunchUrl();
        if (launchUrl?.url) {
          let pathToMatch = "";
          try {
            if (launchUrl.url.startsWith("ecologic://")) {
              pathToMatch = "/" + launchUrl.url.replace("ecologic://", "").replace(/^\/+/, "");
            } else {
              pathToMatch = new URL(launchUrl.url).pathname;
            }
          } catch { /* ignore */ }

          const jobOffer = pathToMatch.match(/^\/job-offer\/(\d+)\/([a-zA-Z0-9]+)/);
          if (jobOffer) {
            sessionStorage.setItem("pendingDeepLink", `/referrals/invite/${jobOffer[2]}`);
          }
          const invite = pathToMatch.match(/^\/invite\/referral\/([a-zA-Z0-9]+)/);
          if (invite) {
            sessionStorage.setItem("pendingDeepLink", `/referrals/invite/${invite[1]}`);
          }
        }
      } catch { /* ignore */ } finally {
        _nativeLaunchUrlChecked = true;
      }
    })();
  } catch {
    _nativeLaunchUrlChecked = true;
  }
}
checkLaunchDeepLink();

function isSubscriptionActive(company: any): boolean {
  if (!company) return false;
  const status = company.subscriptionStatus;
  if (status !== "active" && status !== "trialing") return false;
  const periodEnd = company.currentPeriodEnd || company.trialEndsAt;
  if (periodEnd && new Date(periodEnd) < new Date()) return false;
  return true;
}

function getNextOnboardingRoute(params: {
  user: any;
  onboardingChoice: string | null;
  onboardingIndustry: string | null;
  subActive: boolean;
}): string | null {
  const { user, onboardingChoice, onboardingIndustry, subActive } = params;
  
  const isAndroidNative = isNativePlatform() && getPlatform() === "android";
  const platform = isAndroidNative ? "android" : isNativePlatform() ? "ios" : "web";
  const hasCompany = !!user?.company;

  console.log(
    `[ECOLOGIC-SUB] [routing] getNextOnboardingRoute —` +
    ` platform=${platform}` +
    ` hasCompany=${hasCompany}` +
    ` companyId=${user?.company?.id ?? "none"}` +
    ` onboardingCompleted=${user?.company?.onboardingCompleted ?? false}` +
    ` onboardingChoice=${onboardingChoice ?? "null"}` +
    ` subActive=${subActive}` +
    ` role=${user?.role ?? "none"}` +
    ` userId=${user?.id ?? "none"}`
  );

  if (user?.company) {
    const { onboardingCompleted } = user.company;
    const isOwner = user.role === 'OWNER';

    // Non-owner members (SUPERVISOR, TECHNICIAN) inherit access from the company.
    // They are never routed to the paywall or the subscription purchase flow —
    // that is the company owner's responsibility.
    if (!isOwner) {
      console.log(`[app-router] hasCompany=true role=${user.role} → null (access granted)`);
      return null;
    }

    // Owner: enforce subscription gate
    if (onboardingCompleted && subActive) {
      console.log(`[app-router] hasCompany=true OWNER onboardingCompleted=true subActive=true → null (dashboard)`);
      return null;
    }

    if (onboardingCompleted && !subActive) {
      console.log(`[app-router] hasCompany=true OWNER onboardingCompleted=true subActive=false → /paywall`);
      return "/paywall";
    }

    if (!subActive) {
      console.log(`[app-router] hasCompany=true OWNER onboardingCompleted=false subActive=false → /onboarding/subscription`);
      return "/onboarding/subscription";
    }

    console.log(`[app-router] hasCompany=true OWNER onboardingCompleted=false subActive=true → null (finish onboarding)`);
    return null;
  }

  // No company. Determine the correct onboarding route.
  //
  // KEY RULE: 'employee' onboardingChoice must NEVER bypass the choice screen.
  // Previously this routed directly to /join-company, which broke removed
  // employees — their stale onboardingChoice='employee' sent them to join-company
  // instead of letting them decide whether to create or join a company.
  //
  // OnboardingChoice navigates to /join-company directly when the user clicks
  // "Join a company", so we do not need to do it here.
  if (!onboardingChoice || onboardingChoice === "employee") {
    console.log(`[app-router] hasCompany=false onboardingChoice=${onboardingChoice ?? "null"} → /onboarding/choice`);
    return "/onboarding/choice";
  }

  // Owner mid-onboarding: they chose 'owner' but haven't finished company setup.
  if (!onboardingIndustry) {
    console.log(`[app-router] hasCompany=false onboardingChoice=owner noIndustry → /onboarding/industry`);
    return "/onboarding/industry";
  }

  console.log(`[app-router] hasCompany=false onboardingChoice=owner hasIndustry → /onboarding/company`);
  return "/onboarding/company";
}

// Public invoice payment page - NO auth required
function PublicInvoiceRouter() {
  return (
    <Switch>
      <Route path="/invoice/:id/pay">
        {(params) => <PublicInvoicePay invoiceId={params.id} />}
      </Route>
    </Switch>
  );
}

// Public unsubscribe page - NO auth required
function UnsubscribeRouter() {
  return <PublicUnsubscribe />;
}

const COLD_START_SKIP = ["/auth", "/login", "/signup", "/register", "/forgot-password", "/reset-password", "/onboarding", "/join-company", "/paywall", "/sign", "/wrapper", "/welcome", "/referrals/invite", "/invite/referral", "/job-offer"];

function useColdStartRedirect(ready: boolean) {
  const [, setLocation] = useLocation();
  const attemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!ready || attemptedRef.current) return;

    const doRedirect = () => {
      if (attemptedRef.current) return;
      attemptedRef.current = true;

      const pendingLink = sessionStorage.getItem("pendingDeepLink");
      if (pendingLink) {
        sessionStorage.removeItem("pendingDeepLink");
        console.log("[deep-link] suppressing dashboard redirect, navigating to:", pendingLink);
        setLocation(pendingLink, { replace: true });
        return;
      }

      try {
        const cap = (window as any).Capacitor;
        const platform = cap?.getPlatform?.();
        if (!platform || platform === "web") return;
      } catch { return; }
      const p = window.location.pathname;
      if (COLD_START_SKIP.some((s) => p === s || p.startsWith(s + "/"))) return;
      if (p !== "/") {
        setLocation("/", { replace: true });
      }
    };

    if (_nativeLaunchUrlChecked) {
      doRedirect();
    } else if (_nativeLaunchUrlPromise) {
      console.log("[deep-link] waiting for getLaunchUrl before redirect...");
      _nativeLaunchUrlPromise.then(doRedirect);
    } else {
      doRedirect();
    }
  }, [ready, setLocation]);
}

function AuthenticatedRouter() {
  const path = window.location.pathname;
  const { isAuthenticated, isLoading, user } = useAuth();

  // ── Identify user to Superwall whenever auth resolves ────────────────────
  // Native-only inside the lib; web is a no-op. Idempotent on the same userId.
  React.useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    if (!Capacitor.isNativePlatform()) return;
    import("@/lib/superwall").then(({ identifySuperwallUser }) => {
      identifySuperwallUser(user.id, (user as any).email ?? null);
    }).catch(() => { /* never break the app */ });
  }, [isAuthenticated, user?.id]);

  // Safety net: never let the loading screen hang forever.
  // After 8 seconds we force the app to render regardless of loading state.
  const [authTimedOut, setAuthTimedOut] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (!authTimedOut) {
        console.warn("[auth] Loading timeout reached (8s) — forcing render");
        setAuthTimedOut(true);
      }
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  // Exchange a one-time webAuthCode issued by the production server (for preview
  // Google OAuth cross-domain redirect) into a session.
  //
  // Web: call /api/auth/exchange-code at a RELATIVE URL (same-origin picard proxy).
  //   The picard canvas and the production server are the SAME Express process, so
  //   the relative call finds the code in the shared in-memory store and creates a
  //   picard-domain session cookie. No Bearer / nativeSessionId used on web.
  //
  // Native (Capacitor): call the production URL, store nativeSessionId for Bearer auth.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const webAuthCode = params.get("webAuthCode");
    if (!webAuthCode) return;

    const isNative = !!(window as any).Capacitor?.getPlatform?.() && (window as any).Capacitor.getPlatform() !== "web";
    const hasNativeSession = !!localStorage.getItem("nativeSessionId");
    console.log(`[auth/user][client] source=App.tsx webAuthCode native=${isNative} origin=${window.location.origin} hasNativeSession=${hasNativeSession} attachBearer=${isNative}`);

    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    const prodBase = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || "";
    // isCrossDomain: web preview/canvas on picard origin ≠ production server.
    // The code was created in the PRODUCTION server's in-memory authCodeStore, so
    // exchange-code MUST be called there. Then for cross-domain web, adopt that
    // production session into the local (picard) server for cookie auth.
    const isCrossDomain = !isNative && !!(prodBase && window.location.origin !== prodBase);
    const exchangeUrl = (isNative || isCrossDomain) && prodBase
      ? `${prodBase}/api/auth/exchange-code`
      : "/api/auth/exchange-code";
    console.log("[auth] webAuthCode exchange URL:", exchangeUrl, "isCrossDomain:", isCrossDomain);

    fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: webAuthCode }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) {
          console.error("[auth] webAuthCode exchange failed:", res.status);
          return;
        }
        const data = await res.json();
        if (isNative && data.sessionId) {
          localStorage.setItem("nativeSessionId", data.sessionId);
          console.log("[auth] webAuthCode exchange succeeded — stored nativeSessionId (native)");
        } else if (isCrossDomain && data.sessionId) {
          // Adopt the production session into the local picard-domain session
          const adoptRes = await fetch("/api/auth/adopt-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: data.sessionId }),
            credentials: "include",
          });
          if (adoptRes.ok) {
            console.log("[auth] webAuthCode adopt-session OK — picard session cookie set (web), no Bearer stored");
          } else {
            console.error("[auth] webAuthCode adopt-session failed:", adoptRes.status);
            return;
          }
        } else if (!isNative && !isCrossDomain) {
          console.log("[auth] webAuthCode exchange succeeded — session cookie set (same-domain web)");
        }
        // If this page loaded in a popup (opened by the preview iframe for
        // Google OAuth), close the popup. The opener iframe will detect the
        // auth query invalidation via closedPoll and refetch with cookie auth.
        if (window.opener) {
          console.log("[auth] Running in popup — closing window");
          window.close();
          return;
        }
        // Otherwise (direct navigation), reload so queries re-run with cookie auth.
        window.location.reload();
      })
      .catch((err) => {
        console.error("[auth] webAuthCode exchange error:", err);
      });
  }, []);

  // Listen for localStorage changes from other windows (e.g. a Google auth popup).
  // When the popup stores nativeSessionId, this event fires in the iframe, and we
  // invalidate the auth query so the app picks up the new session immediately.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nativeSessionId" && e.newValue) {
        console.log("[auth] Detected nativeSessionId set by popup — refreshing auth");
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useWebSocket();
  usePushNotifications();

  const hasCompany = !!user?.company;

  const { active: subActive, loading: subLoading, bypass: subBypass } = useSubscriptionGate({
    authed: isAuthenticated,
    loadingAuth: isLoading,
    hasCompany,
    userId: user?.id,
  });

  const coldStartReady = isAuthenticated && hasCompany && !subLoading && subActive;
  useColdStartRedirect(coldStartReady);

  // ── Android cold-start reconcile ────────────────────────────────────────────
  // When the app reopens on Android and the backend says "blocked", automatically
  // query Google Play for an existing active subscription and re-validate it.
  // This heals the case where the DB and Play are momentarily out of sync.
  // Runs at most once per session. Android only. Does nothing on iOS or web.
  //
  // gplayReconciling: while true, show "Verifying subscription..." instead of
  // <Paywall> so the user never sees a paywall flash during the token hand-off.
  const [gplayReconciling, setGplayReconciling] = React.useState(false);
  const reconcileAttemptedRef = React.useRef(false);
  React.useEffect(() => {
    const isAndroid = isNativePlatform() && getPlatform() === "android";
    if (!isAndroid) return;
    if (subLoading) return;
    if (subActive) return;
    if (!isAuthenticated || !hasCompany) return;
    if (reconcileAttemptedRef.current) return;
    reconcileAttemptedRef.current = true;

    console.log("[ECOLOGIC-GPLAY-RACE] paywall prevented during validation — Android cold start, querying Google Play for existing purchases...");
    setGplayReconciling(true);

    (async () => {
      try {
        const { restoreGooglePlayPurchases } = await import("@/lib/nativeIap");
        const result = await restoreGooglePlayPurchases();
        if (!result) {
          console.log("[ECOLOGIC-GPLAY-RESTORE] no active restorable purchase found — staying on paywall");
          return;
        }
        console.log(
          `[ECOLOGIC-GPLAY-RESTORE] restored productId=${result.productId}` +
          ` token suffix=…${result.purchaseToken.slice(-8)}`
        );

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        try {
          const sid = localStorage.getItem("nativeSessionId");
          if (sid) headers["Authorization"] = `Bearer ${sid}`;
        } catch {}

        console.log(
          `[ECOLOGIC-GPLAY-RESTORE] DB before validate — subStatus=${(user as any)?.company?.subscriptionStatus ?? "?"}` +
          ` periodEnd=${(user as any)?.company?.currentPeriodEnd ?? "?"}`
        );
        console.log("[ECOLOGIC-GPLAY-RESTORE] sending validate for restored purchase");

        const res = await fetch("/api/subscriptions/validate", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ platform: "google_play", purchaseToken: result.purchaseToken, productId: result.productId }),
        });
        const data = await res.json();

        if (res.ok && data.ok) {
          console.log(
            `[ECOLOGIC-GPLAY-RESTORE] DB after validate — plan=${data.planKey}` +
            ` periodEnd=${data.currentPeriodEnd ?? "?"} status=active`
          );
          console.log("[ECOLOGIC-GPLAY-RESTORE] re-validation SUCCESS — refreshing billing status");
          queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        } else {
          console.warn(
            `[ECOLOGIC-GPLAY-RESTORE] re-validation failed: ${data.message ?? res.status}` +
            ` — Play likely confirmed subscription expired`
          );
        }
      } catch (err: any) {
        console.error("[ECOLOGIC-SUB] [reconcile] Error during reconcile:", err.message);
      } finally {
        setGplayReconciling(false);
      }
    })();
  }, [isAuthenticated, hasCompany, subLoading, subActive]);

  const onboardingChoice = user?.onboardingChoice || null;
  const onboardingIndustry = localStorage.getItem("onboardingIndustry");

  if (hasCompany) {
    localStorage.removeItem("onboardingChoice");
    localStorage.removeItem("onboardingIndustry");
  }

  const nextRoute = !isLoading && isAuthenticated && user 
    ? getNextOnboardingRoute({ user, onboardingChoice, onboardingIndustry, subActive })
    : null;

  // ── Loading screen ──────────────────────────────────────────────────────────
  // Auth loading: respect the 8-second timeout (prevents hanging spinner when
  //   auth itself fails to resolve — e.g. server unreachable on cold start).
  // Sub loading: NEVER bypass with the timeout — do NOT default to "blocked"
  //   while the billing check is still in-flight. This is the key fix for the
  //   Android paywall-on-relaunch bug: without this guard, authTimedOut=true
  //   caused the gate to fire with subActive=false before the query resolved.
  const subStillPending = isAuthenticated && hasCompany && subLoading;
  if ((!authTimedOut && isLoading) || subStillPending) {
    // Plain white placeholder. The native splash already showed branding;
    // we deliberately render nothing visible here so there is no second
    // "intro" screen between splash and app. No spinner, no wordmark, no
    // "Loading..." text — only an sr-only label for assistive tech.
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="min-h-screen"
        style={{ backgroundColor: '#FFFFFF' }}
        data-testid="startup-placeholder"
      >
        <span className="sr-only">Loading EcoLogic</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/billing/success" component={BillingSuccess} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/" component={Welcome} />
        <Route path="/welcome" component={Welcome} />
        <Route path="/auth">{() => <Redirect to="/login" />}</Route>
        <Route path="/login" component={SignInWizard} />
        <Route path="/register" component={Auth} />
        <Route path="/signup" component={SignupWizard} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/landing" component={Landing} />
        <Route component={Welcome} />
      </Switch>
    );
  }

  if (nextRoute) {
    return (
      <Switch>
        <Route path="/terms" component={TermsOfService} />
        <Route path="/privacy" component={PrivacyPolicy} />
        {/* Allow the signup wizard to stay mounted while onboarding is pending.
            This is needed for the Google new-user flow: complete-registration
            logs the user in (triggering nextRoute), but the SignupWizard must
            remain accessible to let the user finish the role-selection step. */}
        <Route path="/signup" component={SignupWizard} />
        <Route path="/onboarding/choice" component={OnboardingChoice} />
        <Route path="/onboarding/industry" component={IndustryOnboarding} />
        <Route path="/onboarding/company" component={OnboardingCompany} />
        <Route path="/onboarding/subscription" component={OnboardingSubscription} />
        <Route path="/paywall" component={Paywall} />
        <Route path="/billing" component={Billing} />
        <Route path="/billing/success" component={BillingSuccess} />
        <Route path="/join-company" component={JoinCompany} />
        <Route>{() => <Redirect to={nextRoute} />}</Route>
      </Switch>
    );
  }
  
  if (onboardingChoice || onboardingIndustry) {
    console.log("[app-router] onboarding complete, clearing state");
    localStorage.removeItem("onboardingChoice");
    localStorage.removeItem("onboardingIndustry");
  }

  // ── Subscription shell gate ──────────────────────────────────────────────
  // Full-screen lockout: if the owner's subscription is inactive / expired /
  // blocked, render ONLY the Paywall component — no Layout, no header, no
  // sidebar, no mobile nav, no FAB, no notifications bell.
  //
  // This is the definitive gate that runs regardless of how the user arrived
  // (cold start, force-close + reopen, DevTools cancel, in-app status change).
  //
  // Guard conditions:
  //   • subLoading=false  — subscription status is fully resolved (no spinner race)
  //   • !subActive        — access is blocked
  //   • role=OWNER        — non-owners inherit access; never locked out here
  //   • subBypass=false   — dev-bypass accounts are exempt
  const isOwnerRole = user?.role === 'OWNER';
  console.log(
    `[ECOLOGIC-SUB] shell gate check —` +
    ` subActive=${subActive}` +
    ` subLoading=${subLoading}` +
    ` subBypass=${subBypass}` +
    ` role=${user?.role ?? 'none'}` +
    ` hasCompany=${hasCompany}`
  );

  if (isAuthenticated && hasCompany && !subLoading && !subActive && isOwnerRole && !subBypass) {
    // On Android: if the cold-start reconcile is actively querying Google Play
    // and re-validating the purchase token, show a neutral "Verifying..." spinner
    // instead of the full Paywall. This prevents the brief paywall flash that
    // made the app appear to crash during the stale-token → fresh-token handoff.
    if (gplayReconciling) {
      console.log('[ECOLOGIC-GPLAY-RACE] paywall prevented during validation — showing verifying screen');
      return (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#FFFFFF' }}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <p className="text-slate-600 text-sm font-medium">Verifying your subscription...</p>
          </div>
        </div>
      );
    }
    console.log('[ECOLOGIC-SUB] rendering full paywall lockout — no shell chrome');
    return <Paywall />;
  }

  console.log('[ECOLOGIC-SUB] rendering protected app shell');

  return (
    <Layout>
      <Switch>
        <Route path="/choose-plan" component={ChoosePlan} />
        <Route path="/" component={Home} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/leads" component={Leads} />
        <Route path="/leads/:id">
          {(params) => <LeadDetails leadId={params.id} />}
        </Route>
        <Route path="/referrals/invite/:token">
          {() => <JobOfferInvite />}
        </Route>
        <Route path="/subcontractors" component={Contractors} />
        <Route path="/subcontractors/:id">
          {(params) => <ContractorDetail contractorId={params.id} />}
        </Route>
        <Route path="/clients" component={Clients} />
        <Route path="/clients/:id">
          {(params) => <ClientDetail customerId={params.id} />}
        </Route>
        <Route path="/invoicing" component={Invoicing} />
        <Route path="/invoicing/:id">
          {(params) => <InvoiceDetails invoiceId={params.id} />}
        </Route>
        <Route path="/payments" component={PaymentsPage} />
        <Route path="/refunds/new" component={RefundScreen} />
        <Route path="/refunds/other" component={RefundOtherMethod} />
        <Route path="/payments/invoice/:invoiceId">
          {(params) => <InvoicePaymentDetails invoiceId={params.invoiceId} />}
        </Route>
        <Route path="/payments/:id">
          {(params) => <PaymentDetails paymentId={params.id} />}
        </Route>
        <Route path="/documents">
          {() => user?.role === 'TECHNICIAN' ? <Redirect to="/jobs" /> : <Documents />}
        </Route>
        <Route path="/messages" component={MessagesDirectory} />
        <Route path="/messages/u/:userId">
          {(params) => <MessageThread conversationId={params.userId} />}
        </Route>
        <Route path="/messages/c/:conversationId">
          {(params) => <MessageThread conversationId={params.conversationId} />}
        </Route>
        <Route path="/schedule" component={AIScheduling} />
        <Route path="/scheduling">{() => <Redirect to="/schedule" />}</Route>
        <Route path="/ai-scheduling">{() => <Redirect to="/schedule" />}</Route>
        <Route path="/approvals" component={Approvals} />
        <Route path="/employees" component={Employees} />
        <Route path="/timesheets" component={Timesheets} />
        <Route path="/settings" component={Settings} />
        <Route path="/settings/stripe-connect" component={StripeConnectSettings} />
        <Route path="/settings/about" component={About} />
        <Route path="/settings/support" component={Support} />
        <Route path="/settings/support/contact" component={ContactSupport} />
        <Route path="/settings/support/bug" component={ReportBug} />
        <Route path="/settings/support/feature" component={RequestFeature} />
        <Route path="/settings/support/faqs" component={FAQs} />
        <Route path="/settings/legal" component={Legal} />
        <Route path="/settings/legal/terms" component={TermsOfService} />
        <Route path="/settings/legal/privacy" component={PrivacyPolicy} />
        <Route path="/terms" component={TermsOfService} />
        <Route path="/privacy" component={PrivacyPolicy} />
        <Route path="/customize" component={Customize} />
        <Route path="/customize/company-profile" component={CompanyProfile} />
        <Route path="/customize/price-book" component={PriceBook} />
        <Route path="/customize/taxes" component={Taxes} />
        <Route path="/customize/time-tracking" component={TimeTrackingSettings} />
        <Route path="/customize/estimates" component={EstimateSettings} />
        <Route path="/customize/payments" component={PaymentSettings} />
        <Route path="/customize/quickbooks" component={QuickBooksSettings} />
        <Route path="/customize/email-branding" component={EmailBranding} />
        <Route path="/customize/financial-connections" component={FinancialConnections} />
        <Route path="/estimates/:id">
          {(params) => <EstimateDetails estimateId={params.id} />}
        </Route>
        <Route path="/jobs/:id/edit">
          {(params) => <JobEdit jobId={params.id} />}
        </Route>
        <Route path="/jobs/:id">
          {(params) => <JobDetails jobId={params.id} />}
        </Route>
        <Route path="/jobs/:jobId/pay/:invoiceId">
          {(params) => <PaymentReview jobId={params.jobId} invoiceId={params.invoiceId} />}
        </Route>
        <Route path="/billing" component={Billing} />
        <Route path="/billing/success" component={BillingSuccess} />
        <Route path="/upgrade-plan" component={UpgradePlan} />
        <Route path="/paywall" component={Paywall} />
        <Route path="/dev-tools" component={DevTools} />
        <Route path="/profile">{() => <Redirect to="/settings" />}</Route>
        <Route>{() => <Redirect to="/jobs" />}</Route>
      </Switch>
    </Layout>
  );
}

function Router() {
  const [location] = useLocation();
  const path = location;
  const windowPath = window.location.pathname;
  
  // Password reset is PUBLIC - check BOTH wouter and window.location
  // Note: main.tsx now handles /reset-password directly, but keep this as backup
  if (path.startsWith('/reset-password') || windowPath.startsWith('/reset-password')) {
    return <ResetPassword />;
  }
  
  if (path.match(/^\/invoice\/\d+\/pay$/)) {
    return <PublicInvoiceRouter />;
  }
  
  if (path.startsWith('/unsubscribe')) {
    return <UnsubscribeRouter />;
  }

  const campaignResponseMatch = path.match(/^\/campaign-response\/([a-f0-9]{64})$/);
  if (campaignResponseMatch) {
    return <CampaignResponsePage token={campaignResponseMatch[1]} />;
  }

  if (path.startsWith('/payout-setup/')) {
    const setupToken = path.split('/payout-setup/')[1]?.split('?')[0] || '';
    return <PayoutSetup token={setupToken} />;
  }

  const jobOfferRouteMatch = path.match(/^\/job-offer\/\d+\/([a-zA-Z0-9]+)/);
  if (jobOfferRouteMatch) {
    return <Redirect to={`/referrals/invite/${jobOfferRouteMatch[1]}`} />;
  }

  const inviteRedirectMatch = path.match(/^\/invite\/referral\/([a-zA-Z0-9]+)/);
  if (inviteRedirectMatch) {
    console.log("[deep-link] SPA caught /invite/referral/ path, redirecting to invite screen");
    return <Redirect to={`/referrals/invite/${inviteRedirectMatch[1]}`} />;
  }

  if (localStorage.getItem('ecologic_demo_mode')) {
    localStorage.removeItem('ecologic_demo_mode');
  }

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('demo') === '0' || searchParams.get('demo') === 'off') {
    sessionStorage.removeItem('ecologic_demo_mode');
    localStorage.removeItem('ecologic_demo_jobs');
    window.history.replaceState({}, '', '/login');
    return <Redirect to="/login" />;
  }

  if (path === '/demo') {
    return <DemoCreateJob />;
  }

  if (sessionStorage.getItem('ecologic_demo_mode') === '1') {
    return <Redirect to="/demo" />;
  }
  
  // Billing success is a standalone screen — no sidebar, no Layout wrapper.
  // BillingSuccess handles its own auth states (loading / unauthenticated / confirmed).
  if (path === '/billing/success' || path.startsWith('/billing/success?')) {
    return <BillingSuccess />;
  }

  if (path.startsWith('/email-preferences')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return <AuthenticatedRouter />;
}

function usePreventScrollbarShift() {
  React.useEffect(() => {
    const body = document.body;
    const observer = new MutationObserver(() => {
      if (body.style.paddingRight) {
        body.style.paddingRight = '';
      }
      if (body.style.marginRight) {
        body.style.marginRight = '';
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);
}

function resolveDeepLinkPath(url: string): string {
  try {
    if (url.startsWith("ecologic://")) {
      return "/" + url.replace("ecologic://", "").replace(/^\/+/, "");
    }
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return "";
  }
}

function extractDeepLinkTarget(pathToMatch: string): string | null {
  const jobOfferMatch = pathToMatch.match(/^\/job-offer\/(\d+)\/([a-zA-Z0-9]+)/);
  if (jobOfferMatch) {
    return `/referrals/invite/${jobOfferMatch[2]}`;
  }
  const inviteMatch = pathToMatch.match(/^\/invite\/referral\/([a-zA-Z0-9]+)/);
  if (inviteMatch) {
    return `/referrals/invite/${inviteMatch[1]}`;
  }
  return null;
}

function saveDeepLink(target: string, navigate = false) {
  console.log("[deep-link] saved pending=", target, navigate ? "(will navigate)" : "");
  sessionStorage.setItem("pendingDeepLink", target);
  if (navigate) {
    sessionStorage.removeItem("pendingDeepLink");
    window.location.href = target;
  }
}

// Handles ecologic://auth/callback?code=... deep links from the Google OAuth
// bridge page. This is the fast path on iOS versions where SFSafariViewController
// silently opens the custom URL scheme. The polling path in capacitor.ts
// is the primary reliable path; this fires whichever comes first.
// exchangeNativeAuthCode() is idempotent — the second caller is a no-op.
async function handleAuthCallbackUrl(
  url: string,
  closeSystemBrowser: () => Promise<void>,
): Promise<boolean> {
  if (!url.startsWith("ecologic://auth/callback")) return false;

  console.log("[google-auth] Deep link received — closing browser");
  try { await closeSystemBrowser(); } catch {}

  const params = new URL(url.replace("ecologic://", "https://placeholder/")).searchParams;
  const code  = params.get("code");
  const error = params.get("error");

  if (error) {
    console.error("[google-auth] Deep link error param:", error);
    stopPolling(); // statically imported — no await, no microtask delay
    window.location.href = "/login?error=" + encodeURIComponent(error);
    return true;
  }

  if (!code) {
    console.error("[google-auth] Deep link: no code and no error");
    window.location.href = "/login?error=missing_code";
    return true;
  }

  try {
    await exchangeNativeAuthCode(code, "deep-link");
  } catch (err) {
    console.error("[google-auth] Deep link exchange error:", err);
    window.location.href = "/login?error=exchange_failed";
  }
  return true;
}

function useCapacitorDeepLinks() {
  React.useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function setup() {
      try {
        // isNativePlatform and closeSystemBrowser are statically imported at the
        // top of this file — no dynamic import needed here.
        if (!isNativePlatform()) return;

        const { App: CapApp } = await import("@capacitor/app");

        // Cold start: app was launched directly from the deep link URL.
        // IMPORTANT: on iOS, getLaunchUrl() permanently returns the URL that
        // last launched the app even across WebView reloads within the same
        // native process.  Without a guard, an error deep link (e.g.
        // ecologic://auth/callback?error=unknown) would be reprocessed on
        // every React remount caused by window.location.href navigation,
        // creating an infinite /login redirect loop.
        const launchUrl = await CapApp.getLaunchUrl();
        if (launchUrl?.url) {
          const coldUrl = launchUrl.url;

          // ── Stale launch-URL guard ─────────────────────────────────────────
          // Check whether we already processed this exact URL in a previous
          // mount within this native app session.  localStorage persists across
          // WebView reloads but is cleared when the native process is killed,
          // so a genuine new cold-start always gets a fresh chance.
          const prevProcessed = localStorage.getItem(PROCESSED_LAUNCH_URL_KEY);
          if (prevProcessed === coldUrl) {
            console.log(
              "[deep-link] getLaunchUrl already processed this session — skipping stale URL:",
              coldUrl.substring(0, 60),
            );
            // Fall through so the appUrlOpen listener is still registered.
          } else {
            // Mark this URL as processed BEFORE any async work so that a
            // rapid WebView reload cannot sneak in a second execution.
            try { localStorage.setItem(PROCESSED_LAUNCH_URL_KEY, coldUrl); } catch {}
            console.log("[deep-link] getLaunchUrl=", coldUrl);
            const coldPath = resolveDeepLinkPath(coldUrl);

            // Auth callback (cold start) — handle it, then fall through to the
            // appUrlOpen listener setup. We must NOT return early here: doing
            // so would skip registering the listener, breaking all subsequent
            // deep links (job offers, QuickBooks OAuth, etc.) for this session.
            const coldIsAuthCallback = coldUrl.includes("/auth/callback");
            await handleAuthCallbackUrl(coldUrl, closeSystemBrowser);

            // Only try non-auth deep-link handling when the cold-start URL is
            // not an auth callback (auth callbacks have no navigable "target").
            if (!coldIsAuthCallback) {
              if (coldPath.includes("stripe_connect_return=")) {
                console.log("[deep-link] Cold start Stripe Connect return, navigating to:", coldPath);
                window.location.href = coldPath;
                return;
              }

              const coldTarget = extractDeepLinkTarget(coldPath);
              if (coldTarget) {
                const alreadyPending = sessionStorage.getItem("pendingDeepLink");
                if (!alreadyPending) {
                  const tokenSnippet = coldPath.match(/([a-f0-9]{16,})/)?.[1]?.slice(0, 12);
                  console.log("[deep-link] getLaunchUrl token=", tokenSnippet + "..., target=", coldTarget);
                  saveDeepLink(coldTarget, true);
                } else {
                  console.log("[deep-link] getLaunchUrl: pendingDeepLink already set, skipping");
                }
              }
            }
          }
        }

        // Warm start: app was in background, receives the deep link URL
        const listener = await CapApp.addListener("appUrlOpen", async ({ url }) => {
          console.log("[deep-link] appUrlOpen raw=", url);

          const pathToMatch = resolveDeepLinkPath(url);
          console.log("[deep-link] pathname=", pathToMatch);

          // Google OAuth callback — handle first before any other check
          const handled = await handleAuthCallbackUrl(url, closeSystemBrowser);
          if (handled) return;

          if (pathToMatch.includes("stripe_connect_return=")) {
            console.log("[deep-link] Stripe Connect return detected, navigating to:", pathToMatch);
            try { await closeSystemBrowser(); } catch {}
            window.location.href = pathToMatch;
            return;
          }

          // QuickBooks OAuth deep link — dispatch to QuickBooksSettings via DOM event
          if (url.startsWith("ecologic://quickbooks/")) {
            const result = url.includes("/connected") ? "connected" : "error";
            console.log("[deep-link] QB deep link result=" + result);
            window.dispatchEvent(new CustomEvent("qb-oauth-deeplink", { detail: { result } }));
            return;
          }

          const target = extractDeepLinkTarget(pathToMatch);
          if (target) {
            const tokenMatch = pathToMatch.match(/([a-f0-9]{16,})/);
            console.log("[deep-link] appUrlOpen token=", tokenMatch?.[1]?.slice(0, 12) + "...");
            saveDeepLink(target, true);
            return;
          }
        });

        cleanup = () => listener.remove();
      } catch (err) {
        console.error("[deep-link] Setup failed (expected on web):", err);
      }
    }

    setup();
    return () => cleanup?.();
  }, []);
}

function useNativeSafeArea() {
  React.useEffect(() => {
    const cap = (window as any).Capacitor;
    const platform = cap?.getPlatform?.();
    const isNative = !!platform && platform !== "web";
    document.documentElement.classList.toggle("native", isNative);
  }, []);
}

function useAppResumeRefresh() {
  React.useEffect(() => {
    import("@/lib/capacitor").then(({ setupAppResumeRefresh }) => {
      setupAppResumeRefresh();
    });
  }, []);
}

// ── AppsFlyer native init + app_open event ───────────────────────────────────
// Loads lazily so the web bundle isn't affected, and fails safely on any error.
function useAppsFlyerInit() {
  React.useEffect(() => {
    console.log('[main] isNativePlatform =', Capacitor.isNativePlatform());
    if (Capacitor.isNativePlatform()) {
      import("@/lib/appsflyer").then(async ({ initAppsFlyer, trackAppsFlyerEvent, AF_EVENTS }) => {
        const ok = await initAppsFlyer();
        if (ok) {
          trackAppsFlyerEvent(AF_EVENTS.APP_OPEN);
        }
      }).catch(() => { /* never break the app */ });
    }
  }, []);
}

// ── Superwall native init ────────────────────────────────────────────────────
// Loads lazily so the web bundle isn't affected, and fails safely on any error.
function useSuperwallInit() {
  React.useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      import("@/lib/superwall").then(async ({ initSuperwall }) => {
        await initSuperwall();
      }).catch(() => { /* never break the app */ });
    }
  }, []);
}

function App() {
  usePreventScrollbarShift();
  useCapacitorDeepLinks();
  useNativeSafeArea();
  useAppResumeRefresh();
  useAppsFlyerInit();
  useSuperwallInit();

  // ── Hostname-based app routing ────────────────────────────────────────────
  // The same SPA bundle ships to both the customer hostnames (app.* /
  // staging.*) and the internal dashboard hostnames (dashboard.* /
  // staging-dashboard.*). We pick which app shell to mount based on the
  // hostname (with a query/localStorage override for local dev).
  const appMode = React.useMemo(() => getAppMode(), []);
  const isDashboard = appMode === "dashboard";
  React.useEffect(() => {
    console.log(`[main] appMode = ${appMode} host = ${window.location.hostname}`);
  }, [appMode]);

  return (
    <ThemeProvider defaultTheme="light" storageKey="ui-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          {isDashboard ? <DashboardApp /> : <Router />}
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
