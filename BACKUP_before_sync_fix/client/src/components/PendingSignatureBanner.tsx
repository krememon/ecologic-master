import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PendingSignatureBannerProps {
  onCapture: () => void;
}

export function PendingSignatureBanner({ onCapture }: PendingSignatureBannerProps) {
  return (
    <div className="mx-4 mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/50 rounded-full flex items-center justify-center shrink-0">
          <PenLine className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200 truncate">
          Signature required for recent payment
        </p>
      </div>
      <Button
        size="sm"
        onClick={onCapture}
        className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs h-8 px-3"
      >
        Capture Signature
      </Button>
    </div>
  );
}
