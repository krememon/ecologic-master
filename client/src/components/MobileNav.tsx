import { useState, useMemo } from "react";
import { 
  Menu, X, Bell, Filter, Megaphone, AlertTriangle, ClipboardCheck, 
  Calendar, RefreshCw, UserMinus, Timer,
  Building2, LayoutDashboard, Users, UserCheck, FileText, DollarSign,
  FolderOpen, MessageSquare, Settings, LogOut, Brain, UsersIcon, Wrench, Target, Clock, Terminal
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
import { useSidebar } from "@/hooks/useSidebar";

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
  meta?: { conversationId?: number; senderId?: string; messageId?: number; senderName?: string };
}

type NotificationPriority = 'action' | 'update' | 'activity';
type FilterTab = 'all' | 'action' | 'messages';

const PRIORITY_MAP: Record<string, NotificationPriority> = {
  dm_message: 'action',
  job_assigned: 'action',
  job_unassigned: 'action',
  job_cancelled: 'action',
  job_rescheduled: 'action',
  estimate_approved: 'action',
  invoice_overdue: 'action',
  payment_failed: 'action',
  missed_clockout: 'action',
  payment_collected: 'update',
  payment_succeeded: 'update',
  invoice_paid: 'update',
  manual_payment_recorded: 'update',
  refund_issued: 'update',
  estimate_created: 'update',
  job_status_changed: 'update',
  tech_clocked_in: 'activity',
  tech_clocked_out: 'activity',
  job_starting_soon: 'activity',
  announcement: 'activity',
  job_updated: 'activity',
  job_completed: 'activity',
  document_uploaded: 'activity',
};

const PRIORITY_ORDER: Record<NotificationPriority, number> = { action: 0, update: 1, activity: 2 };

function getPriority(type: string): NotificationPriority {
  return PRIORITY_MAP[type] || 'activity';
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'announcement':
      return <Megaphone className="h-4 w-4 text-amber-500" />;
    case 'dm_message':
      return <MessageSquare className="h-4 w-4 text-blue-600" />;
    case 'payment_collected':
    case 'payment_succeeded':
    case 'invoice_paid':
    case 'manual_payment_recorded':
      return <DollarSign className="h-4 w-4 text-green-500" />;
    case 'refund_issued':
      return <DollarSign className="h-4 w-4 text-red-500" />;
    case 'payment_failed':
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case 'estimate_approved':
      return <ClipboardCheck className="h-4 w-4 text-emerald-500" />;
    case 'invoice_overdue':
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case 'job_assigned':
      return <Building2 className="h-4 w-4 text-blue-600" />;
    case 'job_unassigned':
      return <UserMinus className="h-4 w-4 text-orange-500" />;
    case 'job_rescheduled':
      return <Calendar className="h-4 w-4 text-orange-500" />;
    case 'job_status_changed':
      return <RefreshCw className="h-4 w-4 text-indigo-500" />;
    case 'estimate_created':
    case 'estimate_updated':
    case 'estimate_status_changed':
      return <FileText className="h-4 w-4 text-blue-600" />;
    case 'estimate_converted':
      return <ClipboardCheck className="h-4 w-4 text-green-500" />;
    case 'tech_clocked_in':
      return <Clock className="h-4 w-4 text-green-600" />;
    case 'tech_clocked_out':
      return <Timer className="h-4 w-4 text-orange-500" />;
    case 'job_starting_soon':
      return <Calendar className="h-4 w-4 text-blue-500" />;
    default:
      return <Building2 className="h-4 w-4 text-slate-500" />;
  }
};

// Navigation items with permission requirements - must match Sidebar.tsx
const DEV_ALLOWLIST = ['pjpell077@gmail.com'];

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
  { href: "/dev-tools", icon: Terminal, label: "Dev Tools", permission: null, devOnly: true },
];

interface MobileNavProps {
  user: any;
  company: any;
}

export default function MobileNav({ user, company }: MobileNavProps) {
  const { isOpen, toggle: toggleSidebar, close: closeSidebar } = useSidebar();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [location, setLocation] = useLocation();
  const { can, canAny, role } = useCan();
  
  const isAuthed = !!user;

  const { data: unreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ['/api/notifications/unread-count', { view: 'home' }],
    queryFn: async () => {
      const res = await fetch('/api/notifications/unread-count?view=home', { credentials: 'include' });
      if (res.status === 401) return { unreadCount: 0 };
      if (!res.ok) throw new Error('Failed to fetch unread count');
      return res.json();
    },
    enabled: isAuthed,
    refetchInterval: isAuthed ? 30000 : false,
  });

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<Notification[]>({
    queryKey: ['/api/notifications', { view: 'home' }],
    queryFn: async () => {
      const res = await fetch('/api/notifications?view=home', { credentials: 'include' });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    enabled: isAuthed && notificationsOpen,
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

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      console.log('[notify-delete] sending ids:', ids);
      const res = await apiRequest('DELETE', '/api/notifications/bulk', { ids });
      const data = await res.json();
      console.log('[notify-delete] response:', data);
      return { ...data, deletedIds: ids };
    },
    onSuccess: (data) => {
      console.log('[notify-delete] success, deleted:', data?.deleted);
      const deletedSet = new Set(data.deletedIds);
      setSelectMode(false);
      setSelectedIds(new Set());
      queryClient.setQueryData(
        ['/api/notifications', { view: 'home' }],
        (old: Notification[] | undefined) => old ? old.filter(n => !deletedSet.has(n.id)) : []
      );
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
    onError: (error) => {
      console.error('[notify-delete] mutation error:', error);
    },
  });

  const unreadCount = unreadData?.unreadCount || 0;

  const sortedAndFiltered = useMemo(() => {
    let filtered = [...notifications];
    if (activeTab === 'action') {
      filtered = filtered.filter(n => getPriority(n.type) === 'action');
    } else if (activeTab === 'messages') {
      filtered = filtered.filter(n => n.type === 'dm_message');
    }
    filtered.sort((a, b) => {
      const pa = PRIORITY_ORDER[getPriority(a.type)];
      const pb = PRIORITY_ORDER[getPriority(b.type)];
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return filtered;
  }, [notifications, activeTab]);

  const actionCount = useMemo(() => {
    return notifications.filter(n => getPriority(n.type) === 'action' && !n.readAt).length;
  }, [notifications]);

  const messageCount = useMemo(() => {
    return notifications.filter(n => n.type === 'dm_message' && !n.readAt).length;
  }, [notifications]);

  const handleNotificationClick = (notification: Notification) => {
    if (selectMode) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(notification.id)) {
          next.delete(notification.id);
        } else {
          next.add(notification.id);
        }
        return next;
      });
      return;
    }
    if (!notification.readAt) {
      markReadMutation.mutate(notification.id);
    }
    if (notification.linkUrl) {
      setNotificationsOpen(false);
      setLocation(notification.linkUrl);
    }
  };

  const handleClosePanel = () => {
    setNotificationsOpen(false);
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
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
      return navigation.filter(item => !item.permission && !(item as any).excludeRoles && !(item as any).devOnly);
    }
    
    return navigation.filter(item => {
      // devOnly items only show for allowlisted dev accounts
      if ((item as any).devOnly) return DEV_ALLOWLIST.includes(user?.email);
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
  }, [effectiveRole, can, canAny, user?.email]);

  const handleToggle = () => {
    toggleSidebar();
  };

  const handleClose = () => {
    closeSidebar();
  };

  const handleNavItemClick = () => {
    setTimeout(() => {
      closeSidebar();
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
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            <GlobalCreateMenu />
          </div>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <div className={cn(
        "fixed inset-0 sm:hidden transition-all duration-300 ease-in-out",
        isOpen ? "opacity-100 visible" : "opacity-0 invisible"
      )} style={{ zIndex: 10000 }}>
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
          "ecologic-drawer fixed top-0 left-0 bottom-0 w-64 bg-white dark:bg-slate-900 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col",
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
            <nav className="flex-1 overflow-y-auto min-h-0 p-4">
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
                  className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ease-in-out transform hover:scale-105 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 hover:shadow-sm"
                >
                  <LogOut className="w-5 h-5 transition-transform duration-200" />
                  <span className="transition-all duration-200">Sign Out</span>
                </button>
              </div>
            </nav>
        </div>
      </div>

      <Sheet open={notificationsOpen} onOpenChange={(open) => { if (!open) handleClosePanel(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0" hideCloseButton>
          <div className="px-5 pt-5 pb-0">
            {selectMode ? (
              <div className="flex items-center justify-between h-9">
                <button
                  onClick={exitSelectMode}
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                >
                  Cancel
                </button>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
                  disabled={selectedIds.size === 0 || bulkDeleteMutation.isPending}
                  className={cn(
                    "text-sm font-medium transition-colors",
                    selectedIds.size > 0
                      ? "text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                      : "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                  )}
                >
                  {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between h-9">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
                <div className="flex items-center gap-2">
                  {notifications.length > 0 && (
                    <button
                      onClick={() => setSelectMode(true)}
                      className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                      Select
                    </button>
                  )}
                  <button
                    onClick={handleClosePanel}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 pt-3 pb-0">
            <div className="flex gap-1">
              {([
                { key: 'all' as FilterTab, label: 'All' },
                { key: 'action' as FilterTab, label: 'Action Needed', count: actionCount },
                { key: 'messages' as FilterTab, label: 'Messages', count: messageCount },
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                    activeTab === tab.key
                      ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  )}
                >
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={cn(
                      "ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-none",
                      activeTab === tab.key
                        ? "bg-white/20 text-white dark:bg-slate-900/30 dark:text-slate-900"
                        : "bg-red-500 text-white"
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b mx-5 mt-3" />
          
          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6">
            {notificationsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600" />
              </div>
            ) : sortedAndFiltered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[40vh] text-center">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                  {activeTab === 'messages' ? (
                    <MessageSquare className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  ) : activeTab === 'action' ? (
                    <Filter className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  ) : (
                    <Bell className="h-8 w-8 text-slate-400 dark:text-slate-500" />
                  )}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-sm">
                  {activeTab === 'all' ? 'No notifications yet' : activeTab === 'action' ? 'No action items' : 'No messages'}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedAndFiltered.map((notification) => {
                  const priority = getPriority(notification.type);
                  const isActivity = priority === 'activity';
                  const isSelected = selectedIds.has(notification.id);

                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
                        selectMode && isSelected
                          ? "bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-300 dark:ring-blue-700"
                          : notification.readAt
                            ? "bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
                            : priority === 'action'
                              ? "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                              : priority === 'update'
                                ? "bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800"
                                : "bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        {selectMode ? (
                          <div className="mt-0.5 flex-shrink-0">
                            <div className={cn(
                              "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                              isSelected
                                ? "bg-blue-600 border-blue-600"
                                : "border-slate-300 dark:border-slate-600"
                            )}>
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-0.5 flex-shrink-0 flex items-center gap-1.5">
                            {!notification.readAt && (
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                priority === 'action' ? "bg-blue-600" : priority === 'update' ? "bg-slate-400" : "bg-slate-300"
                              )} />
                            )}
                            <span className={cn(isActivity && notification.readAt && "opacity-50")}>
                              {getNotificationIcon(notification.type)}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "text-sm truncate",
                            isActivity ? "font-normal text-slate-600 dark:text-slate-400" : "font-medium text-slate-900 dark:text-slate-100"
                          )}>
                            {notification.type === 'announcement' ? (
                              <>
                                Announcement
                                {notification.meta?.senderName && (
                                  <span className="font-normal text-slate-500 dark:text-slate-400"> from {notification.meta.senderName}</span>
                                )}
                              </>
                            ) : notification.type === 'dm_message' ? (
                              <>
                                {notification.title}
                                <span className="font-normal text-slate-500 dark:text-slate-400"> sent you a message</span>
                              </>
                            ) : (
                              notification.title
                            )}
                          </p>
                          <p className={cn(
                            "text-sm line-clamp-2",
                            isActivity ? "text-slate-400 dark:text-slate-500" : "text-slate-600 dark:text-slate-400"
                          )}>
                            {notification.type === 'dm_message' ? `"${notification.body}"` : notification.body}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {formatTime(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </>
  );
}