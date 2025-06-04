import { useState } from "react";
import { Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "./Sidebar";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  const { data: company } = useQuery({
    queryKey: ["/api/company"],
    enabled: !!user,
  });

  const toggleSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Hamburger clicked, current state:', sidebarOpen);
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    console.log('Sidebar state changed to:', newState);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      <Sidebar 
        user={user} 
        company={company} 
        isOpen={sidebarOpen} 
        onClose={closeSidebar} 
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header with Hamburger */}
        <header className="sm:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 relative z-40">
          <div className="flex items-center justify-between">
            <button
              onClick={toggleSidebar}
              onTouchStart={() => console.log('Touch started on hamburger')}
              onMouseDown={() => console.log('Mouse down on hamburger')}
              className="relative z-50 p-3 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              style={{ 
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation'
              }}
            >
              <Menu className="h-6 w-6 text-slate-600 dark:text-slate-400" />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              {company?.name || 'Dashboard'}
            </h1>
            <div className="w-11" /> {/* Spacer for centering */}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}