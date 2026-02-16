import { useLocation } from "wouter";
import { ChevronLeft, CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCan } from "@/hooks/useCan";

export default function PaymentSettings() {
  const [, navigate] = useLocation();
  const { can } = useCan();

  if (!can("customize.manage")) {
    navigate("/customize");
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <button
        onClick={() => navigate("/customize")}
        className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Customize
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Payment Settings
          </h1>
        </div>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Payment and signature collection settings
        </p>
      </div>

      <Card className="border border-slate-200 dark:border-slate-700 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                Signature after payment
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                A signature capture screen appears automatically after every successful payment. This is always enabled to ensure proper documentation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
