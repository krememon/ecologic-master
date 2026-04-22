import { Link, useLocation } from "wouter";
import { Building2, LayoutDashboard, Users, UserCheck, FileText, DollarSign, FolderOpen, MessageSquare, Brain, PenTool, Settings, LogOut, X, UsersIcon, Wrench, Target, Clock, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import EcoLogicLogo from "./EcoLogicLogo";
import { useCan } from "@/hooks/useCan";
import type { Permission } from "@shared/permissions";

const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

const getNavigation = (role: string | undefined) => [
  { name: "Home", href: "/", icon: LayoutDashboard, permission: null },
  { name: "Schedule", href: "/schedule", icon: Brain, permission: "schedule.view" as Permission },
  { name: role === "TECHNICIAN" ? "My Timesheet" : "Timesheets", href: "/timesheets", icon: Clock, permission: null, excludeRoles: [] as string[] },
  { name: "Jobs", href: "/jobs", icon: Building2, permission: "jobs.view.all" as Permission, excludeRoles: ["TECHNICIAN"] as string[] },
  { name: "Leads", href: "/leads", icon: Target, permission: "leads.view" as Permission },
  { name: "Subcontractors", href: "/subcontractors", icon: Users, permission: "clients.manage" as Permission },
  { name: "Clients", href: "/clients", icon: UserCheck, permission: "clients.manage" as Permission },
  { name: "Invoicing", href: "/invoicing", icon: FileText, permission: "invoicing.manage" as Permission },
  { name: "Payments", href: "/payments", icon: DollarSign, permission: "invoicing.manage" as Permission },
  { name: "Documents", href: "/documents", icon: FolderOpen, permission: "documents.view" as Permission },
  { name: "Messages", href: "/messages", icon: MessageSquare, permission: null },
  { name: "Employees", href: "/employees", icon: UsersIcon, permission: "users.view" as Permission },
  { name: "Dev Tools", href: "/dev-tools", icon: Terminal, permission: null, devOnly: true },
];

interface SidebarProps {
  user: any;
  company: any;
  isOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ user, company, isOpen, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { can, canAny, role: hookRole } = useCan();
  
  // Use role from user prop as fallback (user prop comes from Layout which has auth data)
  const role = hookRole || user?.role;

  // Debug: log role sources
  useEffect(() => {
    console.log('[Sidebar] Role debug - hookRole:', hookRole, 'user?.role:', user?.role, 'final role:', role);
  }, [hookRole, user?.role, role]);

  // Filter navigation items based on current user's permissions
  // useMemo ensures this recalculates when role changes (e.g., after login/logout)
  const filteredNavigation = useMemo(() => {
    const navigation = getNavigation(role);
    
    // If no role yet (auth loading), show base navigation items that don't require permissions
    if (!role) {
      return navigation.filter(item => !item.permission && !(item as any).excludeRoles && !(item as any).devOnly);
    }
    
    return navigation.filter(item => {
      // devOnly items only show for allowlisted dev accounts
      if ((item as any).devOnly) return DEV_ALLOWLIST.includes(user?.email);
      // If item has excludeRoles and current role is excluded, hide the item
      if ((item as any).excludeRoles && (item as any).excludeRoles.includes(role)) {
        return false;
      }
      // If item has permissionAny, check if user has any of those permissions
      if ((item as any).permissionAny) {
        return canAny((item as any).permissionAny);
      }
      // Otherwise, check the single permission (or allow if no permission required)
      return !item.permission || can(item.permission);
    });
  }, [role, can, canAny, user?.email]);

  // Debug logging
  useEffect(() => {
    console.log('[Sidebar] isOpen:', isOpen, 'filteredNav count:', filteredNavigation.length);
  }, [isOpen, filteredNavigation.length]);

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
      <nav className="flex-1 overflow-y-auto min-h-0 px-4 py-6 space-y-1">
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
          <Avatar className="w-10 h-10">
            <AvatarImage src={user?.profileImageUrl ?? undefined} alt="Profile picture" />
            <AvatarFallback className="bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-100 text-sm font-semibold">
              {[user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join("").toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
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
              ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          )}>
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </Link>

        {/* Customize Button - Only for Owner */}
        {can('customize.manage') && (
          <Link href="/customize">
            <button className={cn(
              "w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mt-1",
              location === "/customize"
                ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
            )}>
              <Wrench className="w-4 h-4" />
              <span>Customize</span>
            </button>
          </Link>
        )}

        {/* Logout Button */}
        <button 
          onClick={async () => {
            try {
              console.log("[logout][client] Sidebar logout button clicked");
              await fetch('/api/logout', { method: 'POST', credentials: 'include' });
            } catch {}
            try {
              const { resetPushRegistration } = await import("@/lib/capacitor");
              resetPushRegistration();
            } catch {}
            try {
              const { clearNativeSession } = await import("@/lib/queryClient");
              clearNativeSession();
            } catch {}
            sessionStorage.removeItem("coldStartRedirectDone");
            window.location.href = '/login';
          }}
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