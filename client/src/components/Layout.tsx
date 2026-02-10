import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user } = useAuth();
  const [location] = useLocation();

  const { data: company } = useQuery({
    queryKey: ["/api/company"],
    enabled: !!user,
  });

  // Full-screen routes - no padding, handle nav separately
  const isMessageRoute = location.startsWith('/messages/');
  const isScheduleRoute = location === '/schedule' || location.startsWith('/schedule?');
  const isFullscreenRoute = isMessageRoute || isScheduleRoute;
  const hideMobileNav = isMessageRoute; // Only hide nav for message threads

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden sm:block">
        <Sidebar 
          user={user} 
          company={company} 
          isOpen={true} 
          onClose={() => {}} 
        />
      </div>
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Navigation - hide on message routes only */}
        {!hideMobileNav && <MobileNav user={user} company={company} />}

        {/* Main Content - no padding for fullscreen routes */}
        <main className={`flex-1 min-h-0 overflow-hidden ${isFullscreenRoute ? '' : 'px-4 sm:px-6 lg:px-8 py-6 overflow-y-auto'}`}>
          <div className={isFullscreenRoute ? '' : 'w-full max-w-7xl mx-auto'}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}