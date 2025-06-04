import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user } = useAuth();

  const { data: company } = useQuery({
    queryKey: ["/api/company"],
    enabled: !!user,
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      {/* Desktop Sidebar */}
      <div className="hidden sm:block">
        <Sidebar 
          user={user} 
          company={company} 
          isOpen={true} 
          onClose={() => {}} 
        />
      </div>
      
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Navigation */}
        <MobileNav user={user} company={company} />

        {/* Main Content */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}