import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { Link } from "wouter";
import { Loader2, ChevronLeft, Settings2, Landmark } from "lucide-react";
import { ConnectBankCard } from "@/components/ConnectBankCard";

export default function FinancialConnections() {
  const { isLoading: authLoading } = useAuth();
  const { can } = useCan();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!can('customize.manage')) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl p-8 text-center shadow-sm border border-slate-200 dark:border-slate-700">
          <Settings2 className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Not Authorized</h2>
          <p className="text-slate-600 dark:text-slate-400">
            Only Owners can access customization settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/customize">
          <button className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-4">
            <ChevronLeft className="h-4 w-4" />
            Back to Customize
          </button>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Financial Connections
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Link your bank account for payments and refunds
        </p>
      </div>

      <ConnectBankCard />
    </div>
  );
}
