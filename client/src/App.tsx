import { Switch, Route, Redirect } from "wouter";
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

function Router() {
  // Check for public payment/stripe routes BEFORE any auth hooks
  const path = window.location.pathname;
  if (path.startsWith('/pay/') || path.startsWith('/stripe/')) {
    return <PaymentRouter />;
  }
  
  // Public invoice payment page - NO auth required
  if (path.match(/^\/invoice\/\d+\/pay$/)) {
    return <PublicInvoiceRouter />;
  }
  
  // Public unsubscribe page - NO auth required
  if (path.startsWith('/unsubscribe')) {
    return <UnsubscribeRouter />;
  }
  
  // Public email preferences page - NO auth required (handled by main.tsx)
  if (path.startsWith('/email-preferences')) {
    return null; // main.tsx handles this route
  }

  const { isAuthenticated, isLoading, user } = useAuth();
  
  useWebSocket();
  usePushNotifications();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
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

  if (!user?.company) {
    const onboardingChoice = localStorage.getItem("onboardingChoice");
    console.log("[app-router] no company, onboardingChoice:", onboardingChoice);
    
    if (onboardingChoice === "owner") {
      return (
        <Switch>
          <Route path="/onboarding/company" component={OnboardingCompany} />
          <Route path="/onboarding/choice" component={OnboardingChoice} />
          <Route>{() => <Redirect to="/onboarding/company" />}</Route>
        </Switch>
      );
    }
    
    if (onboardingChoice === "employee") {
      return (
        <Switch>
          <Route path="/join-company" component={JoinCompany} />
          <Route path="/onboarding/choice" component={OnboardingChoice} />
          <Route>{() => <Redirect to="/join-company" />}</Route>
        </Switch>
      );
    }
    
    return (
      <Switch>
        <Route path="/onboarding/choice" component={OnboardingChoice} />
        <Route path="/onboarding/company" component={OnboardingCompany} />
        <Route path="/join-company" component={JoinCompany} />
        <Route>{() => <Redirect to="/onboarding/choice" />}</Route>
      </Switch>
    );
  }

  // Industry onboarding step removed - owners go directly to dashboard after company creation
  // Clear any stale onboarding choice since onboarding is now complete
  if (user.role === 'OWNER' && user.company) {
    const onboardingChoice = localStorage.getItem("onboardingChoice");
    if (onboardingChoice) {
      console.log("[app-router] owner with company, clearing stale onboardingChoice");
      localStorage.removeItem("onboardingChoice");
    }
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

function App() {
  // Check for public routes BEFORE rendering Router (which uses auth hooks)
  const path = window.location.pathname;
  
  // Public unsubscribe pages - NO auth required, render before any auth logic
  if (path.startsWith('/unsubscribe/')) {
    return (
      <ThemeProvider defaultTheme="light" storageKey="ui-theme">
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <PublicUnsubscribe />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }
  
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
