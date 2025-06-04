import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { 
  Bell, 
  Download, 
  Menu,
  Building2, 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  FileText, 
  FolderOpen, 
  MessageSquare,
  Brain,
  Settings
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: Building2 },
  { name: "Subcontractors", href: "/subcontractors", icon: Users },
  { name: "Clients", href: "/clients", icon: UserCheck },
  { name: "Invoicing", href: "/invoicing", icon: FileText },
  { name: "AI Scheduling", href: "/ai-scheduling", icon: Brain },
  { name: "Documents", href: "/documents", icon: FolderOpen },
  { name: "Messages", href: "/messages", icon: MessageSquare },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface HeaderProps {
  title: string;
  subtitle: string;
  user: any;
}

export default function Header({ title, subtitle, user }: HeaderProps) {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="bg-white dark:bg-slate-900 shadow-sm border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Mobile menu button */}
        <div className="flex items-center space-x-3">
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden">
                <Menu className="w-6 h-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0" aria-describedby="mobile-navigation-description">
              <div className="flex flex-col h-full">
                {/* Logo Section */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: user?.company?.secondaryColor || '#5EEAD4' }}
                    >
                      <Building2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {user?.company?.name || 'EcoLogic'}
                      </h1>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Construction Management</p>
                    </div>
                  </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-6 space-y-2">
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = location === item.href;
                    
                    return (
                      <Link key={item.name} href={item.href}>
                        <div
                          className={cn(
                            "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                            isActive
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800"
                          )}
                          onClick={() => setIsOpen(false)}
                        >
                          <Icon className="w-5 h-5" />
                          <span>{item.name}</span>
                        </div>
                      </Link>
                    );
                  })}
                </nav>
                <div id="mobile-navigation-description" className="sr-only">
                  Mobile navigation menu for accessing all app features
                </div>
              </div>
            </SheetContent>
          </Sheet>
          
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-100 truncate">{title}</h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-4">
          <Button variant="ghost" size="icon" className="hidden sm:flex">
            <Download className="w-6 h-6" />
          </Button>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full"></span>
          </Button>
        </div>
      </div>
    </header>
  );
}
