import { Sparkles, Bot } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import dropletLogo from "@/assets/branding/ecologic-droplet.png";
const outlineLogo = "/assets/ecologic-outline-cropped.png";

interface EcoAiPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EcoAiPanel({ open, onOpenChange }: EcoAiPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[420px] flex flex-col">
        <SheetHeader className="pb-4 border-b border-slate-200 dark:border-slate-800">
          <SheetTitle className="flex items-center gap-2.5">
            <img src={dropletLogo} alt="" className="w-6 h-6 object-contain" />
            <span>Eco-Intelligence</span>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-900/30 dark:to-emerald-900/30 flex items-center justify-center mb-6">
            <Bot className="w-10 h-10 text-teal-600 dark:text-teal-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Eco-Intelligence
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-[280px] leading-relaxed">
            Your AI-powered construction assistant is coming soon. Get smart scheduling, material estimates, and project insights — all in one place.
          </p>
          <div className="mt-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs font-medium">
            <Sparkles className="h-3 w-3" />
            Coming Soon
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface EcoAiButtonProps {
  onClick: () => void;
  className?: string;
}

export function EcoAiButton({ onClick, className = "" }: EcoAiButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`relative w-9 h-9 -mr-0.5 flex items-center justify-center rounded-full text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${className}`}
      aria-label="Open Eco-Intelligence"
      title="Eco-Intelligence"
    >
      <img
        src={outlineLogo}
        alt="Eco-AI"
        className="object-contain"
        style={{ width: 26, height: 26, opacity: 0.95, filter: "drop-shadow(0 0 0.5px rgba(0,0,0,0.35))" }}
      />
    </button>
  );
}
