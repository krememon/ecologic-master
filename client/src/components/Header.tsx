import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, Bell, Check, Trash2, Megaphone, MessageSquare, Briefcase, DollarSign, AlertTriangle, ClipboardCheck, Calendar, FileText, UserMinus, RefreshCw, Clock, Timer } from "lucide-react";
import { useSidebar } from "@/hooks/useSidebar";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalCreateMenu } from "./GlobalCreateMenu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
      return <Briefcase className="h-4 w-4 text-blue-600" />;
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
      return <Briefcase className="h-4 w-4 text-slate-500" />;
  }
};

interface HeaderProps {
  title: string;
  subtitle?: string;
  user?: any;
  className?: string;
}

export default function Header({ title, subtitle, user, className }: HeaderProps) {
  const { toggle } = useSidebar();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: unreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ['/api/notifications/unread-count'],
    refetchInterval: 30000,
  });

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
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

  return (
    <>
      <header className={cn(
        "flex items-center justify-between p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800",
        className
      )}>
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            className="sm:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-1.5">
          <ThemeToggle />
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
      </header>

      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md notificationsModalRoot">
          <SheetHeader className="space-y-0 pb-0">
            <div className="flex items-center justify-between px-0 py-1">
              <SheetTitle className="text-base font-semibold">Notifications</SheetTitle>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => markAllReadMutation.mutate()}
                    disabled={markAllReadMutation.isPending}
                    className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Mark all read
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => clearAllMutation.mutate()}
                    disabled={clearAllMutation.isPending}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label="Clear all"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </SheetHeader>
          <div className="border-b -mx-6 mt-2" />
          
          {clearError && (
            <div className="mt-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded">
              {clearError}
            </div>
          )}
          
          <div className="mt-4 -mx-6 px-6 overflow-y-auto max-h-[calc(100vh-8rem)]">
            {isLoading ? (
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
                      <div className="mt-1 flex-shrink-0 flex items-center gap-2">
                        {!notification.readAt && (
                          <span className="w-2 h-2 rounded-full bg-blue-600" />
                        )}
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
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
                        <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                          {notification.type === 'dm_message' ? `"${notification.body}"` : notification.body}
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
