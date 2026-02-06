import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SelectCustomerModal } from "@/components/CustomerModals";
import { useLocation } from "wouter";
import type { Customer } from "@shared/schema";
import {
  X,
  Banknote,
  FileText,
  CreditCard,
  Loader2,
  User,
  FileWarning,
} from "lucide-react";

export function RecordPaymentModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check" | "card">("cash");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [noInvoicesModalOpen, setNoInvoicesModalOpen] = useState(false);
  const [checking, setChecking] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ["/api/payments/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
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
    setNoInvoicesModalOpen(false);
    onOpenChange(false);
  };

  const handleRecordPayment = async () => {
    if (!selectedCustomer) return;
    const amountVal = parseFloat(amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast({ title: "Error", description: "Enter a valid amount", variant: "destructive" });
      return;
    }

    setChecking(true);
    try {
      const res = await fetch("/api/invoices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load invoices");
      const invoices = await res.json();
      const unpaid = invoices.filter((inv: any) => {
        if (inv.customerId !== selectedCustomer.id) return false;
        const status = (inv.status || "").toLowerCase();
        return status === "unpaid" || status === "partial";
      });

      if (unpaid.length === 0) {
        setNoInvoicesModalOpen(true);
        return;
      }

      recordMutation.mutate();
    } catch {
      recordMutation.mutate();
    } finally {
      setChecking(false);
    }
  };

  const customerDisplayName = selectedCustomer
    ? (selectedCustomer.companyName || [selectedCustomer.firstName, selectedCustomer.lastName].filter(Boolean).join(" ") || "Unknown")
    : null;

  const isSubmitting = checking || recordMutation.isPending;

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
                onClick={handleRecordPayment}
                disabled={!selectedCustomer || !amount || isSubmitting}
                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                {isSubmitting ? (
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

      <Dialog open={noInvoicesModalOpen} onOpenChange={setNoInvoicesModalOpen}>
        <DialogContent className="w-[95vw] max-w-[380px] rounded-2xl p-0 gap-0 overflow-hidden [&>button]:hidden">
          <div className="flex flex-col items-center px-6 pt-7 pb-6">
            <div className="w-14 h-14 bg-amber-50 dark:bg-amber-950/30 rounded-full flex items-center justify-center mb-4">
              <FileWarning className="w-7 h-7 text-amber-500 dark:text-amber-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
              No Open Invoices
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center leading-relaxed">
              This customer has no unpaid invoices.{"\n"}Create an invoice before recording a payment.
            </p>
          </div>
          <div className="flex gap-3 px-5 pb-5">
            <Button
              variant="outline"
              onClick={() => setNoInvoicesModalOpen(false)}
              className="flex-1 h-11 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                resetAndClose();
                navigate("/invoicing");
              }}
              className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              Create Invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
