import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useWebSocket } from "@/hooks/useWebSocket";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Home from "@/pages/Home";
import Jobs from "@/pages/Jobs";
import Subcontractors from "@/pages/Subcontractors";
import Clients from "@/pages/Clients";
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

  return (
    <Switch>
      {isLoading || !isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/" component={Home} />
          <Route path="/jobs" component={Jobs} />
          <Route path="/subcontractors" component={Subcontractors} />
          <Route path="/clients" component={Clients} />
          <Route path="/invoicing" component={Invoicing} />
          <Route path="/documents" component={Documents} />
          <Route path="/messages" component={Messages} />
          <Route path="/ai-scheduling" component={AIScheduling} />
          <Route path="/settings" component={Settings} />
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
