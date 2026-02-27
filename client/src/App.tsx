import * as React from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import Layout from "@/components/Layout";
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
import PaySuccess from "@/pages/PaySuccess";
import PayCancel from "@/pages/PayCancel";
import StripeReturn from "@/pages/StripeReturn";
import PaymentReview from "@/pages/PaymentReview";
import PublicInvoicePay from "@/pages/PublicInvoicePay";
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
import SignupWizard from "@/pages/SignupWizard";
import Welcome from "@/pages/Welcome";
import SignInWizard from "@/pages/SignInWizard";
import OnboardingChoice from "@/pages/OnboardingChoice";
import OnboardingCompany from "@/pages/OnboardingCompany";
import OnboardingSubscription from "@/pages/OnboardingSubscription";
import Paywall from "@/pages/Paywall";
import DemoCreateJob from "@/pages/DemoCreateJob";
import PayoutSetup from "@/pages/PayoutSetup";

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
  
  if (user?.company) {
    const { onboardingCompleted } = user.company;

    if (onboardingCompleted && subActive) {
      return null;
    }

    if (onboardingCompleted && !subActive) {
      return "/paywall";
    }

    if (!subActive) {
      return "/onboarding/subscription";
    }

    return null;
  }
  
  if (!onboardingChoice) {
    return "/onboarding/choice";
  }
  
  if (onboardingChoice === "employee") {
    return "/join-company";
  }
  
  if (!onboardingIndustry) {
    return "/onboarding/industry";
  }
  
  return "/onboarding/company";
}

// Separate component for public payment pages - NO auth hooks
function PaymentRouter() {
  return (
    <Switch>
      <Route path="/pay/success" component={PaySuccess} />
      <Route path="/pay/cancel" component={PayCancel} />
      <Route path="/stripe/return" component={StripeReturn} />
    </Switch>
  );
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

const COLD_START_SKIP = ["/auth", "/login", "/signup", "/register", "/forgot-password", "/reset-password", "/onboarding", "/join-company", "/paywall", "/sign", "/wrapper", "/welcome"];

function useColdStartRedirect(ready: boolean) {
  const [, setLocation] = useLocation();
  React.useEffect(() => {
    if (!ready) return;
    if (sessionStorage.getItem("coldStartRedirectDone")) return;
    sessionStorage.setItem("coldStartRedirectDone", "1");
    try {
      const cap = (window as any).Capacitor;
      const platform = cap?.getPlatform?.();
      if (!platform || platform === "web") return;
    } catch { return; }
    const p = window.location.pathname;
    if (COLD_START_SKIP.some((s) => p === s || p.startsWith(s + "/"))) return;
    if (p !== "/") {
      console.log("[cold-start] Native cold start, redirecting to /");
      setLocation("/", { replace: true });
    }
  }, [ready, setLocation]);
}

function AuthenticatedRouter() {
  const path = window.location.pathname;
  const { isAuthenticated, isLoading, user } = useAuth();
  
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

  const onboardingChoice = user?.onboardingChoice || null;
  const onboardingIndustry = localStorage.getItem("onboardingIndustry");
  const nextRoute = !isLoading && isAuthenticated && user 
    ? getNextOnboardingRoute({ user, onboardingChoice, onboardingIndustry, subActive })
    : null;

  if (isLoading || (isAuthenticated && hasCompany && subLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading EcoLogic...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Switch>
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
        <Route path="/onboarding/choice" component={OnboardingChoice} />
        <Route path="/onboarding/industry" component={IndustryOnboarding} />
        <Route path="/onboarding/company" component={OnboardingCompany} />
        <Route path="/onboarding/subscription" component={OnboardingSubscription} />
        <Route path="/paywall" component={Paywall} />
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

  return (
    <Layout>
      {subBypass && (
        <div className="fixed top-2 right-2 z-50 bg-yellow-500 text-black text-xs font-semibold px-2 py-1 rounded shadow">
          DEV: Subscription bypass
        </div>
      )}
      <Switch>
        <Route path="/choose-plan" component={ChoosePlan} />
        <Route path="/" component={Home} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/leads" component={Leads} />
        <Route path="/leads/:id">
          {(params) => <LeadDetails leadId={params.id} />}
        </Route>
        <Route path="/subcontractors" component={Contractors} />
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
        <Route path="/stripe/return" component={StripeReturn} />
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
  
  if (path.startsWith('/pay/') || path.startsWith('/stripe/')) {
    return <PaymentRouter />;
  }
  
  if (path.match(/^\/invoice\/\d+\/pay$/)) {
    return <PublicInvoiceRouter />;
  }
  
  if (path.startsWith('/unsubscribe')) {
    return <UnsubscribeRouter />;
  }

  if (path.startsWith('/payout-setup/')) {
    const setupToken = path.split('/payout-setup/')[1]?.split('?')[0] || '';
    return <PayoutSetup token={setupToken} />;
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

function useCapacitorDeepLinks() {
  React.useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function setup() {
      try {
        const { isNativePlatform, closeSystemBrowser } = await import("@/lib/capacitor");
        if (!isNativePlatform()) {
          console.log("[deep-link] Web platform detected, skipping deep link setup");
          return;
        }

        console.log("[deep-link] Native platform detected, setting up deep link listener");
        const { App: CapApp } = await import("@capacitor/app");

        const listener = await CapApp.addListener("appUrlOpen", async ({ url }) => {
          console.log("[deep-link] Received:", url);

          if (url.startsWith("ecologic://stripe-return")) {
            console.log("[deep-link] Stripe return detected");
            try {
              const { Browser } = await import("@capacitor/browser");
              await Browser.close();
            } catch {}

            const params = new URL(url.replace("ecologic://", "https://placeholder/")).searchParams;
            const result = params.get("result");
            const invoiceId = params.get("invoiceId");

            queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/status"] });
            queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
            queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/payments"] });

            if (result === "success" && invoiceId) {
              window.location.href = `/invoice/${invoiceId}/pay?success=1`;
            } else if (invoiceId) {
              window.location.href = `/invoice/${invoiceId}/pay?canceled=1`;
            } else {
              window.location.href = "/jobs";
            }
            return;
          }

          if (!url.startsWith("ecologic://auth/callback")) return;

          await closeSystemBrowser();

          const params = new URL(url.replace("ecologic://", "https://placeholder/")).searchParams;
          const code = params.get("code");
          const error = params.get("error");

          if (error) {
            console.error("[deep-link] Auth error:", error);
            window.location.href = "/login?error=" + error;
            return;
          }

          if (code) {
            try {
              const res = await fetch("/api/auth/exchange-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code }),
                credentials: "include",
              });

              if (res.ok) {
                console.log("[deep-link] Auth code exchanged successfully");
                queryClient.invalidateQueries({ queryKey: ["/api/user"] });
                window.location.href = "/";
              } else {
                console.error("[deep-link] Exchange failed:", res.status);
                window.location.href = "/login?error=exchange_failed";
              }
            } catch (err) {
              console.error("[deep-link] Exchange error:", err);
              window.location.href = "/login?error=exchange_failed";
            }
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

function App() {
  usePreventScrollbarShift();
  useCapacitorDeepLinks();
  useNativeSafeArea();

  return (
    <ThemeProvider defaultTheme="light" storageKey="ui-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
