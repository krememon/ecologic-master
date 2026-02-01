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
import EmailBranding from "@/pages/EmailBranding";
import QuickBooksSettings from "@/pages/QuickBooksSettings";
import PublicUnsubscribe from "@/pages/PublicUnsubscribe";
import SignupWizard from "@/pages/SignupWizard";
import Welcome from "@/pages/Welcome";
import SignInWizard from "@/pages/SignInWizard";
import OnboardingChoice from "@/pages/OnboardingChoice";
import OnboardingCompany from "@/pages/OnboardingCompany";

// Centralized onboarding route logic
// Role selection happens ONLY in /signup - no separate /onboarding/choice
function getNextOnboardingRoute(params: {
  user: any;
  onboardingChoice: string | null;
  onboardingIndustry: string | null;
}): string | null {
  const { user, onboardingChoice, onboardingIndustry } = params;
  
  // If user has a company
  if (user?.company) {
    const { onboardingCompleted, subscriptionStatus } = user.company;
    
    // Existing company with onboarding complete -> go to dashboard
    // Treat any company with onboardingCompleted=true as fully set up
    if (onboardingCompleted) {
      return null; // Go to dashboard
    }
    
    // NEW company that hasn't completed onboarding yet
    // Check if they need to start a trial
    const hasActiveSub = subscriptionStatus === "active" || subscriptionStatus === "trialing";
    if (!hasActiveSub) {
      return "/onboarding/company"; // Shows subscription/trial step
    }
    
    return null; // Subscription active, go to dashboard
  }
  
  // No company yet - check which path they're on
  // Employee path
  if (onboardingChoice === "employee") {
    return "/join-company";
  }
  
  // Owner path (explicit or default)
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

function AuthenticatedRouter() {
  const path = window.location.pathname;
  const { isAuthenticated, isLoading, user } = useAuth();
  
  useWebSocket();
  usePushNotifications();

  // Get onboarding state
  const onboardingChoice = localStorage.getItem("onboardingChoice");
  const onboardingIndustry = localStorage.getItem("onboardingIndustry");
  const nextRoute = !isLoading && isAuthenticated && user 
    ? getNextOnboardingRoute({ user, onboardingChoice, onboardingIndustry })
    : null;

  if (isLoading) {
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

  // If onboarding is incomplete, force user to complete it
  if (nextRoute) {
    return (
      <Switch>
        <Route path="/onboarding/industry" component={IndustryOnboarding} />
        <Route path="/onboarding/company" component={OnboardingCompany} />
        <Route path="/join-company" component={JoinCompany} />
        <Route>{() => <Redirect to={nextRoute} />}</Route>
      </Switch>
    );
  }
  
  // Onboarding complete - clear any stale state
  if (onboardingChoice || onboardingIndustry) {
    console.log("[app-router] onboarding complete, clearing state");
    localStorage.removeItem("onboardingChoice");
    localStorage.removeItem("onboardingIndustry");
  }

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
        <Route path="/documents" component={Documents} />
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
        <Route path="/customize/quickbooks" component={QuickBooksSettings} />
        <Route path="/customize/email-branding" component={EmailBranding} />
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
  
  if (path.startsWith('/email-preferences')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return <AuthenticatedRouter />;
}

function App() {
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
