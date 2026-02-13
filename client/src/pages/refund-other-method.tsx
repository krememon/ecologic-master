import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ChevronRight,
  PenLine,
  Check,
} from "lucide-react";

import cashappLogo from "@assets/cashapp_1771019226190.png";
import zelleLogo from "@assets/zelle_1771019233453.png";
import paypalLogo from "@assets/paypal_1771019235274.png";
import appleLogo from "@assets/apple_1771019223810.png";
import googleLogo from "@assets/google_1771019227458.png";
import metaLogo from "@assets/meta_1771019231718.png";
import venmoLogo from "@assets/venmo_1771019229614.png";

const otherMethods = [
  { id: "Cash App", logo: cashappLogo, bg: "#00D632" },
  { id: "Zelle", logo: zelleLogo, bg: "#6C1CD3" },
  { id: "PayPal", logo: paypalLogo, bg: "#003087" },
  { id: "Apple Cash", logo: appleLogo, bg: "#000000" },
  { id: "Google Pay", logo: googleLogo, bg: "#FFFFFF" },
  { id: "Meta Pay", logo: metaLogo, bg: "#0082FB" },
  { id: "Venmo", logo: venmoLogo, bg: "#008CFF" },
];

export default function RefundOtherMethod() {
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const invoiceId = searchParams.get("invoiceId");
  const paymentId = searchParams.get("paymentId");
  const currentSelection = searchParams.get("current");

  const [showCustom, setShowCustom] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const buildReturnUrl = (detail: string) => {
    const params = new URLSearchParams();
    if (paymentId) params.set("paymentId", paymentId);
    if (invoiceId) params.set("invoiceId", invoiceId);
    params.set("otherMethod", detail);
    return `/refunds/new?${params.toString()}`;
  };

  const handleSelect = (methodId: string) => {
    navigate(buildReturnUrl(methodId));
  };

  const handleCustomSubmit = () => {
    const val = customValue.trim();
    if (val) {
      navigate(buildReturnUrl(val));
    }
  };

  const handleBack = () => {
    const params = new URLSearchParams();
    if (paymentId) params.set("paymentId", paymentId);
    if (invoiceId) params.set("invoiceId", invoiceId);
    if (currentSelection) params.set("otherMethod", currentSelection);
    navigate(`/refunds/new?${params.toString()}`);
  };

  return (
    <div className="p-4 sm:p-5 max-w-2xl mx-auto space-y-5">
      <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Select refund app</h1>
        <p className="text-[12px] text-slate-400 dark:text-slate-500 mt-1">
          Choose how you sent the refund outside EcoLogic.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {otherMethods.map((method) => {
            const isGooglePay = method.id === "Google Pay";
            return (
              <button
                key={method.id}
                onClick={() => handleSelect(method.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: method.bg,
                    border: isGooglePay ? "1px solid #e2e8f0" : "none",
                  }}
                >
                  <img
                    src={method.logo}
                    alt={method.id}
                    className="object-contain"
                    style={{
                      width: 20,
                      height: 20,
                      filter: isGooglePay ? "none" : "brightness(0) invert(1)",
                    }}
                  />
                </div>
                <span className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">{method.id}</span>
                {currentSelection === method.id ? (
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                )}
              </button>
            );
          })}

          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                <PenLine className="w-[18px] h-[18px]" />
              </div>
              <span className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">Custom</span>
              <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
            </button>
          ) : (
            <div className="px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                <PenLine className="w-[18px] h-[18px]" />
              </div>
              <Input
                autoFocus
                placeholder="Type custom method..."
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(); }}
                className="flex-1 h-9 rounded-lg bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-700 text-sm"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customValue.trim()}
                className="text-sm font-semibold text-blue-600 dark:text-blue-400 disabled:text-slate-300 dark:disabled:text-slate-600 px-2 py-1 hover:bg-blue-50 dark:hover:bg-blue-950/20 rounded-lg transition-colors disabled:hover:bg-transparent"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
