import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useSidebar } from "@/hooks/useSidebar";
import { cn } from "@/lib/utils";
import LanguageSelector from "./LanguageSelector";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalCreateMenu } from "./GlobalCreateMenu";

interface HeaderProps {
  title: string;
  subtitle?: string;
  user?: any;
  className?: string;
}

export default function Header({ title, subtitle, user, className }: HeaderProps) {
  const { toggle } = useSidebar();

  return (
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
      
      <div className="flex items-center space-x-3">
        <LanguageSelector variant="button" showLabel={false} />
        <ThemeToggle />
        <GlobalCreateMenu />
      </div>
    </header>
  );
}