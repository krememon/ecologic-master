import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SelectCustomerModal } from "@/components/CustomerModals";
import type { Customer } from "@shared/schema";
import {
  X,
  Banknote,
  FileText,
  CreditCard,
  Loader2,
  User,
} from "lucide-react";

export function RecordPaymentModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check" | "card">("cash");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);

  const recordMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) throw new Error("Select a customer");
      const amountVal = parseFloat(amount);
      if (isNaN(amountVal) || amountVal <= 0) throw new Error("Enter a valid amount");
      const res = await apiRequest("POST", "/api/payments/record", {
        customerId: selectedCustomer.id,
        amount: amountVal,
        method,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payment recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      resetAndClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetAndClose = () => {
    setSelectedCustomer(null);
    setAmount("");
    setMethod("cash");
    onOpenChange(false);
  };

  const customerDisplayName = selectedCustomer
    ? (selectedCustomer.companyName || [selectedCustomer.firstName, selectedCustomer.lastName].filter(Boolean).join(" ") || "Unknown")
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else onOpenChange(v); }}>
        <DialogContent className="w-[95vw] max-w-[420px] rounded-2xl p-0 gap-0 overflow-hidden [&>button]:hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="min-w-[44px]" />
              <DialogTitle className="text-base font-semibold text-center flex-1">Record Payment</DialogTitle>
              <button onClick={resetAndClose} className="min-w-[44px] flex items-center justify-end">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
          </DialogHeader>

          <div className="px-5 pb-5 space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Customer</Label>
              {selectedCustomer ? (
                <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {customerDisplayName}
                    </p>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCustomerPickerOpen(true)}
                  className="w-full flex items-center gap-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-400" />
                  </div>
                  <span className="text-sm text-slate-400">Select customer...</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Amount</Label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-8 h-10 rounded-xl bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "cash" as const, label: "Cash", icon: Banknote },
                  { key: "check" as const, label: "Check", icon: FileText },
                  { key: "card" as const, label: "Card", icon: CreditCard },
                ]).map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      onClick={() => setMethod(m.key)}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                        method === m.key
                          ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400"
                          : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                onClick={resetAndClose}
                className="flex-1 h-11 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                onClick={() => recordMutation.mutate()}
                disabled={!selectedCustomer || !amount || recordMutation.isPending}
                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                {recordMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Record Payment"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SelectCustomerModal
        open={customerPickerOpen}
        onOpenChange={setCustomerPickerOpen}
        onSelectCustomer={(customer) => {
          setSelectedCustomer(customer);
          setCustomerPickerOpen(false);
        }}
        canCreateCustomer={false}
      />
    </>
  );
}
