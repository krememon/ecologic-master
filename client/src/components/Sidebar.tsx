import { Link, useLocation } from "wouter";
import { Building2, LayoutDashboard, Users, UserCheck, FileText, DollarSign, FolderOpen, MessageSquare, Brain, PenTool, Settings, LogOut, X, UsersIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import EcoLogicLogo from "./EcoLogicLogo";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCan";
import type { Permission } from "@shared/permissions";

const getNavigation = (t: any) => [
  { name: t('navigation.home'), href: "/", icon: LayoutDashboard, permission: null },
  { name: t('navigation.schedule'), href: "/schedule", icon: Brain, permission: "schedule.view" as Permission },
  { name: t('navigation.jobs'), href: "/jobs", icon: Building2, permission: "jobs.view.all" as Permission, permissionAny: ["jobs.view.all", "jobs.view.assigned"] as Permission[] },
  { name: t('navigation.subcontractors'), href: "/subcontractors", icon: Users, permission: "clients.manage" as Permission },
  { name: t('navigation.clients'), href: "/clients", icon: UserCheck, permission: "clients.manage" as Permission },
  { name: t('navigation.invoicing'), href: "/invoicing", icon: FileText, permission: "invoicing.manage" as Permission },
  { name: "Payments", href: "/payments", icon: DollarSign, permission: "invoicing.manage" as Permission },
  { name: t('navigation.documents'), href: "/documents", icon: FolderOpen, permission: "documents.view" as Permission },
  { name: t('navigation.messages'), href: "/messages", icon: MessageSquare, permission: null },
  { name: "Employees", href: "/employees", icon: UsersIcon, permission: "users.view" as Permission },
];

interface SidebarProps {
  user: any;
  company: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ user, company, isOpen, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const { can, canAny, role } = useCan();

  // Filter navigation items based on current user's permissions
  // useMemo ensures this recalculates when role changes (e.g., after login/logout)
  const filteredNavigation = useMemo(() => {
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

  // Debug logging
  useEffect(() => {
    console.log('Sidebar received isOpen state:', isOpen);
  }, [isOpen]);

  // Close sidebar on route change (mobile only, not on initial mount)
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    if (hasMounted) {
      onClose();
    } else {
      setHasMounted(true);
    }
  }, [location, onClose, hasMounted]);

  return (
    <>
      {/* Mobile overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-black transition-opacity duration-300 ease-in-out sm:hidden z-40",
          isOpen ? "opacity-50" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside className={cn(
        "flex w-64 bg-white dark:bg-slate-900 shadow-lg border-r border-slate-200 dark:border-slate-800 flex-col transition-transform duration-300 ease-in-out",
        "sm:relative sm:translate-x-0", // Always visible and in layout on larger screens
        "fixed inset-y-0 z-50", // Fixed position on mobile
        isOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0" // Toggle on mobile, always visible on desktop
      )}>
      {/* Logo Section */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <EcoLogicLogo size={48} showText={true} className="justify-center" />
        <div className="mt-3 text-center">
          <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {company?.name || user?.firstName + ' ' + user?.lastName || 'Trade Contractor'}
          </h2>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {filteredNavigation.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;

          return (
            <Link key={item.name} href={item.href}>
              <div className={cn(
                "flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors",
                isActive 
                  ? "text-white" 
                  : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              )}
              style={isActive ? { backgroundColor: company?.primaryColor || '#0EA5E9' } : {}}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-3 mb-3">
          <img 
            src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.firstName || 'U')}&background=random`}
            alt="Profile picture" 
            className="w-10 h-10 rounded-full object-cover"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {user?.role ? user.role.charAt(0) + user.role.slice(1).toLowerCase() : 'User'}
            </p>
          </div>
        </div>

        {/* Settings Button */}
        <Link href="/settings">
          <button className={cn(
            "w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mt-1",
            location === "/settings"
              ? "bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          )}>
            <Settings className="w-4 h-4" />
            <span>{t('navigation.settings')}</span>
          </button>
        </Link>

        {/* Logout Button */}
        <button 
          onClick={() => window.location.href = '/api/logout'}
          className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-700 dark:hover:text-red-300 mt-2"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
    </>
  );
}