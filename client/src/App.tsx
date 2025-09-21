import { Switch, Route } from "wouter";
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
import Messages from "@/pages/Messages";
import PaymentsPage from "@/pages/payments-page";
import AIScheduling from "@/pages/AIScheduling";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import ProfileNew from "@/pages/ProfileNew";
import Approvals from "@/pages/Approvals";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import ChoosePlan from "@/pages/ChoosePlan";
import { withSubscriptionGuard } from "@/hooks/useSubscription";

// Wrap protected components with subscription guard
const ProtectedHome = withSubscriptionGuard(Home);
const ProtectedJobs = withSubscriptionGuard(Jobs);
const ProtectedContractors = withSubscriptionGuard(Contractors);
const ProtectedClients = withSubscriptionGuard(Clients);
const ProtectedInvoicing = withSubscriptionGuard(Invoicing);
const ProtectedPayments = withSubscriptionGuard(PaymentsPage);
const ProtectedDocuments = withSubscriptionGuard(Documents);
const ProtectedMessages = withSubscriptionGuard(Messages);
const ProtectedAIScheduling = withSubscriptionGuard(AIScheduling);
const ProtectedApprovals = withSubscriptionGuard(Approvals);

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  
  // Initialize WebSocket and push notifications for authenticated users
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
        <Route path="/" component={Landing} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/register" component={Auth} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/choose-plan" component={ChoosePlan} />
        <Route path="/" component={ProtectedHome} />
        <Route path="/jobs" component={ProtectedJobs} />
        <Route path="/subcontractors" component={ProtectedContractors} />
        <Route path="/clients" component={ProtectedClients} />
        <Route path="/invoicing" component={ProtectedInvoicing} />
        <Route path="/payments" component={ProtectedPayments} />
        <Route path="/documents" component={ProtectedDocuments} />
        <Route path="/messages" component={ProtectedMessages} />
        <Route path="/ai-scheduling" component={ProtectedAIScheduling} />
        <Route path="/approvals" component={ProtectedApprovals} />
        <Route path="/settings" component={Settings} />
        <Route path="/profile" component={Profile} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
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
