import { Button } from "@/components/ui/button";
import { Bell, Download } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle: string;
  user: any;
}

export default function Header({ title, subtitle, user }: HeaderProps) {
  return (
    <header className="bg-white dark:bg-slate-900 shadow-sm border-b border-slate-200 dark:border-slate-800 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon">
            <Download className="w-6 h-6" />
          </Button>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full"></span>
          </Button>
        </div>
      </div>
    </header>
  );
}
