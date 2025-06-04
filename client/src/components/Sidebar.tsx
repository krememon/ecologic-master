import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  Building2, 
  LayoutDashboard, 
  Users, 
  UserCheck, 
  FileText, 
  FolderOpen, 
  MessageSquare 
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: Building2 },
  { name: "Subcontractors", href: "/subcontractors", icon: Users },
  { name: "Clients", href: "/clients", icon: UserCheck },
  { name: "Invoicing", href: "/invoicing", icon: FileText },
  { name: "Documents", href: "/documents", icon: FolderOpen },
  { name: "Messages", href: "/messages", icon: MessageSquare },
];

interface SidebarProps {
  user: any;
  company: any;
}

export default function Sidebar({ user, company }: SidebarProps) {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-white dark:bg-slate-900 shadow-lg border-r border-slate-200 dark:border-slate-800 flex flex-col">
      {/* Logo Section */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-3">
          <div 
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: company?.secondaryColor || '#059669' }}
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1">
        {navigation.map((item) => {
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
              style={isActive ? { backgroundColor: company?.primaryColor || '#2563EB' } : {}}
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
        <div className="flex items-center space-x-3">
          <img 
            src={user?.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.firstName || 'U')}&background=random`}
            alt="Profile picture" 
            className="w-10 h-10 rounded-full object-cover"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">Project Manager</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
