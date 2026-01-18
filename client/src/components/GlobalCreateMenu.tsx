import { useState, useCallback, useEffect } from "react";
import { Plus, Briefcase, FileText, Receipt, X } from "lucide-react";
import { useLocation } from "wouter";
import { useCan } from "@/hooks/useCan";
import { cn } from "@/lib/utils";

interface MenuItem {
  id: string;
  label: string;
  icon: typeof Briefcase;
  permission: string;
  route: string;
}

const menuItems: MenuItem[] = [
  { id: "job", label: "Job", icon: Briefcase, permission: "jobs.create", route: "/jobs?create=true" },
  { id: "estimate", label: "Estimate", icon: FileText, permission: "estimates.create", route: "/jobs?createEstimate=true" },
  { id: "invoice", label: "Invoice", icon: Receipt, permission: "invoicing.manage", route: "/invoicing?create=true" },
];

export function GlobalCreateMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { can, role } = useCan();

  const visibleItems = menuItems.filter(item => can(item.permission as any));

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleItemClick = useCallback((route: string) => {
    setIsOpen(false);
    setTimeout(() => {
      setLocation(route);
    }, 100);
  }, [setLocation]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleClose]);

  if (role === "TECHNICIAN" || visibleItems.length === 0) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="relative w-9 h-9 flex items-center justify-center rounded-full bg-green-600 hover:bg-green-700 text-white shadow-md transition-all duration-150 hover:scale-105 active:scale-95"
        aria-label="Create new"
      >
        <Plus className="h-5 w-5" />
      </button>

      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-end"
          onClick={handleClose}
        >
          <div 
            className={cn(
              "fixed inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm",
              "animate-in fade-in duration-150"
            )}
          />
          
          <div 
            className={cn(
              "relative z-10 mt-16 mr-4 flex flex-col items-end gap-3",
              "animate-in slide-in-from-top-2 fade-in duration-200"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 shadow-md transition-all duration-150"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>

            {visibleItems.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-3",
                  "animate-in slide-in-from-right fade-in duration-200"
                )}
                style={{ animationDelay: `${(index + 1) * 50}ms` }}
              >
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg shadow-sm">
                  {item.label}
                </span>
                <button
                  onClick={() => handleItemClick(item.route)}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-green-600 hover:bg-green-700 text-white shadow-lg transition-all duration-150 hover:scale-105 active:scale-95"
                  aria-label={`Create ${item.label}`}
                >
                  <item.icon className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
