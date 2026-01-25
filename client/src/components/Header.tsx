import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, Bell } from "lucide-react";
import { useSidebar } from "@/hooks/useSidebar";
import { cn } from "@/lib/utils";
import LanguageSelector from "./LanguageSelector";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalCreateMenu } from "./GlobalCreateMenu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface HeaderProps {
  title: string;
  subtitle?: string;
  user?: any;
  className?: string;
}

export default function Header({ title, subtitle, user, className }: HeaderProps) {
  const { toggle } = useSidebar();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  
  const unreadCount = 0;

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
        
        <div className="flex items-center space-x-2">
          <LanguageSelector variant="button" showLabel={false} />
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
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
            <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <Bell className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              No notifications yet
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}