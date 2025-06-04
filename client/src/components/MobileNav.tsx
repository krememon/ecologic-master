import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Building2, 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  FileText, 
  FolderOpen, 
  MessageSquare, 
  Calendar, 
  Settings 
} from "lucide-react";

interface MobileNavProps {
  user: any;
  company: any;
}

export default function MobileNav({ user, company }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  const handleToggle = () => {
    console.log('Mobile nav toggle clicked, current state:', isOpen);
    setIsOpen(!isOpen);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleNavItemClick = () => {
    // Add a small delay for visual feedback before closing
    setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const navigationItems = [
    { href: "/", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/jobs", icon: Building2, label: "Jobs" },
    { href: "/subcontractors", icon: UserCheck, label: "Subcontractors" },
    { href: "/clients", icon: Users, label: "Clients" },
    { href: "/invoicing", icon: FileText, label: "Invoicing" },
    { href: "/documents", icon: FolderOpen, label: "Documents" },
    { href: "/messages", icon: MessageSquare, label: "Messages" },
    { href: "/ai-scheduling", icon: Calendar, label: "AI Scheduling" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <>
      {/* Mobile Header */}
      <div className="sm:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div 
            onClick={handleToggle}
            className="p-2 cursor-pointer select-none"
            style={{ touchAction: 'manipulation' }}
          >
            <Menu className="h-6 w-6 text-slate-600 dark:text-slate-400" />
          </div>
          
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {company?.name || 'Dashboard'}
          </h1>
          
          <div className="w-10" />
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <div className={cn(
        "fixed inset-0 z-50 sm:hidden transition-all duration-300 ease-in-out",
        isOpen ? "opacity-100 visible" : "opacity-0 invisible"
      )}>
        {/* Background overlay */}
        <div 
          className={cn(
            "fixed inset-0 bg-black transition-all duration-300 ease-in-out",
            isOpen ? "bg-opacity-50 backdrop-blur-sm" : "bg-opacity-0"
          )}
          onClick={handleClose}
        />
        
        {/* Sidebar */}
        <div className={cn(
          "fixed top-0 left-0 bottom-0 w-64 bg-white dark:bg-slate-900 shadow-xl transform transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}>
            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: company?.secondaryColor || '#5EEAD4' }}
                  >
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {company?.name || 'EcoLogic'}
                    </h1>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Construction Management</p>
                  </div>
                </div>
                <div onClick={handleClose} className="p-1 cursor-pointer">
                  <X className="h-5 w-5 text-slate-400" />
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4">
              <div className="space-y-1">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  
                  return (
                    <Link 
                      key={item.href} 
                      href={item.href}
                      onClick={handleNavItemClick}
                    >
                      <div className={cn(
                        "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out transform hover:scale-105",
                        isActive 
                          ? "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 shadow-sm" 
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm"
                      )}>
                        <Icon className="w-5 h-5 transition-transform duration-200" />
                        <span className="transition-all duration-200">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </nav>
        </div>
      </div>
    </>
  );
}