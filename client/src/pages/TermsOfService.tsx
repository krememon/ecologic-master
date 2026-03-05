import { Link } from "wouter";
import { ChevronLeft } from "lucide-react";

export default function TermsOfService() {
  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/settings/legal">
          <button className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-3">
            <ChevronLeft className="h-4 w-4" />
            Legal
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Terms of Service</h1>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          Content coming soon.
        </p>
      </div>
    </div>
  );
}
