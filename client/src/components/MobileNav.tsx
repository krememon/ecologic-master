import { useState, useMemo } from "react";
import { Menu, X, Bell, Check, Trash2 } from "lucide-react";
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
  Wrench,
  Target,
  Clock
} from "lucide-react";
import EcoLogicLogo from "./EcoLogicLogo";
import { useCan } from "@/hooks/useCan";
import { GlobalCreateMenu } from "./GlobalCreateMenu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Permission } from "@shared/permissions";

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

// Navigation items with permission requirements - must match Sidebar.tsx
const getNavigation = (role: string | undefined) => [
  { href: "/", icon: LayoutDashboard, label: "Home", permission: null },
  { href: "/schedule", icon: Brain, label: "Schedule", permission: "schedule.view" as Permission },
  { href: "/timesheets", icon: Clock, label: role === "TECHNICIAN" ? "My Timesheet" : "Timesheets", permission: null, excludeRoles: [] as string[] },
  { href: "/jobs", icon: Building2, label: "Jobs", permission: "jobs.view.all" as Permission, excludeRoles: ["TECHNICIAN"] as string[] },
  { href: "/leads", icon: Target, label: "Leads", permission: "leads.view" as Permission },
  { href: "/subcontractors", icon: UserCheck, label: "Subcontractors", permission: "clients.manage" as Permission },
  { href: "/clients", icon: Users, label: "Clients", permission: "clients.manage" as Permission },
  { href: "/invoicing", icon: FileText, label: "Invoicing", permission: "invoicing.manage" as Permission },
  { href: "/payments", icon: DollarSign, label: "Payments", permission: "invoicing.manage" as Permission },
  { href: "/documents", icon: FolderOpen, label: "Documents", permission: "documents.view" as Permission },
  { href: "/messages", icon: MessageSquare, label: "Messages", permission: null },
  { href: "/employees", icon: UsersIcon, label: "Employees", permission: "users.view" as Permission },
  { href: "/settings", icon: Settings, label: "Settings", permission: null },
];

interface MobileNavProps {
  user: any;
  company: any;
}

export default function MobileNav({ user, company }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { can, canAny, role } = useCan();
  
  const { data: unreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ['/api/notifications/unread-count'],
    refetchInterval: 30000,
  });

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<Notification[]>({
    queryKey: ['/api/notifications'],
    enabled: notificationsOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      return apiRequest('POST', `/api/notifications/${notificationId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
    },
  });

  const [clearError, setClearError] = useState<string | null>(null);
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', '/api/notifications');
    },
    onSuccess: () => {
      setClearError(null);
      queryClient.setQueryData(['/api/notifications'], []);
      queryClient.setQueryData(['/api/notifications/unread-count'], { unreadCount: 0 });
    },
    onError: () => {
      setClearError('Failed to clear notifications');
    },
  });

  const unreadCount = unreadData?.unreadCount || 0;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.readAt) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.linkUrl) {
      setNotificationsOpen(false);
      setLocation(notification.linkUrl);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Use role from hook or user prop as fallback
  const effectiveRole = role || user?.role;

  // Filter navigation items based on current user's permissions
  // This recalculates when role changes (e.g., after login/logout)
  const navigationItems = useMemo(() => {
    const navigation = getNavigation(effectiveRole);
    
    // If no role yet, show base items without permissions or excludeRoles
    if (!effectiveRole) {
      return navigation.filter(item => !item.permission && !(item as any).excludeRoles);
    }
    
    return navigation.filter(item => {
      // If item has excludeRoles and current role is excluded, hide the item
      if ((item as any).excludeRoles && (item as any).excludeRoles.includes(effectiveRole)) {
        return false;
      }
      // If item has permissionAny, check if user has any of those permissions
      if ((item as any).permissionAny) {
        return canAny((item as any).permissionAny);
      }
      // Otherwise, check the single permission (or allow if no permission required)
      return !item.permission || can(item.permission);
    });
  }, [effectiveRole, can, canAny]);

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
          
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setNotificationsOpen(true)}
              className="relative w-9 h-9 flex items-center justify-center rounded-full text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
            <GlobalCreateMenu />
          </div>
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
          "ecologic-drawer fixed top-0 left-0 bottom-0 w-64 bg-white dark:bg-slate-900 shadow-xl transform transition-transform duration-300 ease-in-out",
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
                  onClick={async () => {
                    try {
                      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
                    } catch {}
                    sessionStorage.removeItem("coldStartRedirectDone");
                    window.location.href = '/login';
                  }}
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out transform hover:scale-105 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:shadow-sm"
                >
                  <LogOut className="w-5 h-5 transition-transform duration-200" />
                  <span className="transition-all duration-200">Sign Out</span>
                </button>
              </div>
            </nav>
        </div>
      </div>

      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader className="flex flex-row items-center justify-between pb-4 border-b">
            <SheetTitle>Notifications</SheetTitle>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAllReadMutation.mutate()}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Mark all read
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clearAllMutation.mutate()}
                  disabled={clearAllMutation.isPending}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </SheetHeader>
          
          {clearError && (
            <div className="mt-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
              {clearError}
            </div>
          )}
          
          <div className="mt-4 -mx-6 px-6 overflow-y-auto max-h-[calc(100vh-8rem)]">
            {notificationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[40vh] text-center">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  <Bell className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  No notifications yet
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "w-full text-left px-3 py-3 rounded-lg transition-colors",
                      notification.readAt
                        ? "bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
                        : "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {!notification.readAt && (
                        <span className="mt-2 w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
                      )}
                      <div className={cn("flex-1 min-w-0", notification.readAt && "ml-5")}>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {notification.title}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                          {notification.body}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                          {formatTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </>
  );
}