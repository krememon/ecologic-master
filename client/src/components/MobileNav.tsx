import { useState, useMemo } from "react";
import { Menu, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Building2, 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  FileText, 
  DollarSign,
  FolderOpen, 
  MessageSquare, 
  Calendar, 
  Settings,
  LogOut,
  Brain,
  UsersIcon,
  Wrench
} from "lucide-react";
import EcoLogicLogo from "./EcoLogicLogo";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCan";
import type { Permission } from "@shared/permissions";

// Navigation items with permission requirements - must match Sidebar.tsx
const getNavigation = (t: any) => [
  { href: "/", icon: LayoutDashboard, label: t('navigation.home'), permission: null },
  { href: "/schedule", icon: Brain, label: t('navigation.schedule'), permission: "schedule.view" as Permission },
  { href: "/jobs", icon: Building2, label: t('navigation.jobs'), permission: "jobs.view.all" as Permission, permissionAny: ["jobs.view.all", "jobs.view.assigned"] as Permission[] },
  { href: "/subcontractors", icon: UserCheck, label: t('navigation.subcontractors'), permission: "clients.manage" as Permission },
  { href: "/clients", icon: Users, label: t('navigation.clients'), permission: "clients.manage" as Permission },
  { href: "/invoicing", icon: FileText, label: t('navigation.invoicing'), permission: "invoicing.manage" as Permission },
  { href: "/payments", icon: DollarSign, label: "Payments", permission: "invoicing.manage" as Permission },
  { href: "/documents", icon: FolderOpen, label: t('navigation.documents'), permission: "documents.view" as Permission },
  { href: "/messages", icon: MessageSquare, label: t('navigation.messages'), permission: null },
  { href: "/employees", icon: UsersIcon, label: "Employees", permission: "users.view" as Permission },
  { href: "/settings", icon: Settings, label: t('navigation.settings'), permission: null },
];

interface MobileNavProps {
  user: any;
  company: any;
}

export default function MobileNav({ user, company }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const { t } = useTranslation();
  const { can, canAny, role } = useCan();

  // Filter navigation items based on current user's permissions
  // This recalculates when role changes (e.g., after login/logout)
  const navigationItems = useMemo(() => {
    const navigation = getNavigation(t);
    
    // If no role, show no navigation items (safety check)
    if (!role) {
      return [];
    }
    
    return navigation.filter(item => {
      // If item has permissionAny, check if user has any of those permissions
      if ((item as any).permissionAny) {
        return canAny((item as any).permissionAny);
      }
      // Otherwise, check the single permission (or allow if no permission required)
      return !item.permission || can(item.permission);
    });
  }, [t, role, can, canAny]);

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
          
          <EcoLogicLogo size={32} showText={false} />
          
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
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <EcoLogicLogo size={40} showText={true} className="justify-start" />
                  <div className="mt-2">
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                      {company?.name || user?.firstName + ' ' + user?.lastName || 'Trade Contractor'}
                    </p>
                  </div>
                </div>
                <div onClick={handleClose} className="p-1 cursor-pointer mt-0.5">
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
              
              {/* Customize Button - Only for Owner */}
              {can('customize.manage') && (
                <div className="mt-4">
                  <Link href="/customize" onClick={handleNavItemClick}>
                    <div className={cn(
                      "flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out transform hover:scale-105",
                      location === "/customize"
                        ? "bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 shadow-sm"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:shadow-sm"
                    )}>
                      <Wrench className="w-5 h-5 transition-transform duration-200" />
                      <span className="transition-all duration-200">Customize</span>
                    </div>
                  </Link>
                </div>
              )}

              {/* Logout Button */}
              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                <button 
                  onClick={() => window.location.href = '/api/logout'}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out transform hover:scale-105 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:shadow-sm"
                >
                  <LogOut className="w-5 h-5 transition-transform duration-200" />
                  <span className="transition-all duration-200">Sign Out</span>
                </button>
              </div>
            </nav>
        </div>
      </div>
    </>
  );
}