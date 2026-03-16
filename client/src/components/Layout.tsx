import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";
import { SidebarProvider } from "@/hooks/useSidebar";

const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user } = useAuth() as { user: any };
  const [location, navigate] = useLocation();
  const seqRef = useRef<string[]>([]);

  // Keyboard shortcut: Shift+D → V = open dev tools (dev accounts only)
  useEffect(() => {
    if (!user?.email || !DEV_ALLOWLIST.includes(user.email)) return;
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'D') {
        seqRef.current = ['D'];
      } else if (seqRef.current[0] === 'D' && e.key === 'v') {
        seqRef.current = [];
        navigate('/dev-tools');
      } else {
        seqRef.current = [];
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user?.email, navigate]);

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
    <SidebarProvider>
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
            <div className={isFullscreenRoute ? 'h-full' : 'w-full max-w-7xl mx-auto'}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}