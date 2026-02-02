import { useState, useCallback, useEffect } from "react";
import { Plus, Briefcase, FileText, Receipt, UserPlus, CalendarPlus, Megaphone } from "lucide-react";
import { useLocation } from "wouter";
import { useCan } from "@/hooks/useCan";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { AnnouncementModal } from "./AnnouncementModal";

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
  { id: "lead", label: "Lead", icon: UserPlus, permission: "leads.convert", route: "/leads?create=true" },
  { id: "event", label: "Event", icon: CalendarPlus, permission: "schedule.manage", route: "/schedule?createEvent=true" },
];

const useReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);
  
  return prefersReducedMotion;
};

export function GlobalCreateMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [, setLocation] = useLocation();
  const { can, role } = useCan();
  const reducedMotion = useReducedMotion();
  
  const isOwner = role === "OWNER";

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

  const duration = reducedMotion ? 0.01 : 0.2;
  const staggerDelay = reducedMotion ? 0 : 0.04;

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-9 h-9 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md"
        aria-label="Create new"
        data-testid="global-create-plus"
        animate={{ rotate: isOpen ? 45 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Plus className="h-5 w-5" />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-start justify-end"
            onClick={handleClose}
          >
            <motion.div 
              className="fixed inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration }}
            />
            
            <motion.div 
              className="relative z-10 mt-16 mr-4 flex flex-col items-end gap-3"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <motion.button
                onClick={handleClose}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 shadow-md"
                aria-label="Close menu"
                initial={{ opacity: 0, scale: 0.9, rotate: -45 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.9, rotate: -45 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus className="h-5 w-5 rotate-45" />
              </motion.button>

              {visibleItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  transition={{
                    duration,
                    delay: (index + 1) * staggerDelay,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <motion.span 
                    className="text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg shadow-sm"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{
                      duration,
                      delay: (index + 1) * staggerDelay + 0.02,
                    }}
                  >
                    {item.label}
                  </motion.span>
                  <motion.button
                    onClick={() => handleItemClick(item.route)}
                    className={cn(
                      "w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg"
                    )}
                    aria-label={`Create ${item.label}`}
                    whileHover={{ scale: 1.08, backgroundColor: "#1d4ed8" }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <item.icon className="h-5 w-5" />
                  </motion.button>
                </motion.div>
              ))}
              
              {/* Announcement bubble - Owner only */}
              {isOwner && (
                <motion.div
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  transition={{
                    duration,
                    delay: (visibleItems.length + 1) * staggerDelay,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <motion.span 
                    className="text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1.5 rounded-lg shadow-sm"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{
                      duration,
                      delay: (visibleItems.length + 1) * staggerDelay + 0.02,
                    }}
                  >
                    Announcement
                  </motion.span>
                  <motion.button
                    onClick={() => {
                      setIsOpen(false);
                      setShowAnnouncementModal(true);
                    }}
                    className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg"
                    aria-label="Create Announcement"
                    whileHover={{ scale: 1.08, backgroundColor: "#1d4ed8" }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <Megaphone className="h-5 w-5" />
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      <AnnouncementModal 
        open={showAnnouncementModal} 
        onOpenChange={setShowAnnouncementModal} 
      />
    </>
  );
}
