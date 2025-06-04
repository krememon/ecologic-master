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
import Home from "@/pages/Home";
import Jobs from "@/pages/Jobs";
import Subcontractors from "@/pages/Subcontractors";
import ClientsSimple from "@/pages/ClientsSimple";
import Invoicing from "@/pages/Invoicing";
import Documents from "@/pages/Documents";
import Messages from "@/pages/Messages";
import AIScheduling from "@/pages/AIScheduling";
import Settings from "@/pages/Settings";

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
        <Route path="/" component={AuthPage} />
        <Route path="/auth" component={AuthPage} />
        <Route component={AuthPage} />
      </Switch>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/subcontractors" component={Subcontractors} />
        <Route path="/clients" component={ClientsSimple} />
        <Route path="/invoicing" component={Invoicing} />
        <Route path="/documents" component={Documents} />
        <Route path="/messages" component={Messages} />
        <Route path="/ai-scheduling" component={AIScheduling} />
        <Route path="/settings" component={Settings} />
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
