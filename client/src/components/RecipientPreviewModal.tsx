import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Mail, MessageSquare, Users, X, Loader2 } from "lucide-react";

type Channel = "email" | "sms" | "both";

interface Recipient {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  emailEligible: boolean;
  smsEligible: boolean;
  emailDisabledReason: string | null;
  smsDisabledReason: string | null;
}

interface RecipientPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  recipients: Recipient[];
  selectedIds: number[];
  onConfirm: (ids: number[]) => void;
  isLoading?: boolean;
}

export default function RecipientPreviewModal({
  open,
  onOpenChange,
  channel,
  recipients,
  selectedIds,
  onConfirm,
  isLoading = false,
}: RecipientPreviewModalProps) {
  const [localSelectedIds, setLocalSelectedIds] = useState<number[]>(selectedIds);

  useEffect(() => {
    if (open) {
      setLocalSelectedIds(selectedIds);
    }
  }, [open, selectedIds]);

  const isEligible = (r: Recipient) => {
    if (channel === "email") return r.emailEligible;
    if (channel === "sms") return r.smsEligible;
    return r.emailEligible || r.smsEligible;
  };

  const getDisabledReason = (r: Recipient) => {
    if (channel === "email") return r.emailDisabledReason;
    if (channel === "sms") return r.smsDisabledReason;
    if (!r.emailEligible && !r.smsEligible) {
      return r.emailDisabledReason || r.smsDisabledReason;
    }
    return null;
  };

  const toggleRecipient = (id: number) => {
    setLocalSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    onConfirm(localSelectedIds);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalSelectedIds(selectedIds);
    onOpenChange(false);
  };

  const eligibleRecipients = recipients.filter(isEligible);
  const ineligibleRecipients = recipients.filter((r) => !isEligible(r));
  
  const emailSelectedCount = localSelectedIds.filter((id) => {
    const r = recipients.find((rec) => rec.id === id);
    return r?.emailEligible;
  }).length;
  
  const smsSelectedCount = localSelectedIds.filter((id) => {
    const r = recipients.find((rec) => rec.id === id);
    return r?.smsEligible;
  }).length;

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden [&>button]:hidden">
        <div className="flex flex-col h-full max-h-[85vh]">
          {/* Fixed Header */}
          <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
            <button
              type="button"
              onClick={handleCancel}
              className="absolute right-4 top-1/2 -translate-y-1/2"
            >
              <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            </button>
            <div className="text-center">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-center gap-2">
                <Users className="h-4 w-4" />
                Recipients
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choose who will receive this campaign
              </p>
            </div>
          </div>

          {/* Summary Row */}
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {channel === "email" && `${emailSelectedCount} email recipient${emailSelectedCount !== 1 ? 's' : ''} selected`}
              {channel === "sms" && `${smsSelectedCount} text recipient${smsSelectedCount !== 1 ? 's' : ''} selected`}
              {channel === "both" && `${emailSelectedCount} email • ${smsSelectedCount} text selected`}
            </p>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {/* Eligible Recipients */}
                {eligibleRecipients.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => toggleRecipient(r.id)}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={localSelectedIds.includes(r.id)}
                      onCheckedChange={() => toggleRecipient(r.id)}
                      className="h-5 w-5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {r.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(channel === "email" || channel === "both") && r.emailEligible && (
                        <Mail className="h-4 w-4 text-blue-500" />
                      )}
                      {(channel === "sms" || channel === "both") && r.smsEligible && (
                        <MessageSquare className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  </div>
                ))}

                {/* Ineligible Recipients */}
                {ineligibleRecipients.length > 0 && (
                  <>
                    <div className="px-5 py-2 bg-slate-100 dark:bg-slate-800">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        Not Eligible ({ineligibleRecipients.length})
                      </p>
                    </div>
                    {ineligibleRecipients.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 px-5 py-3 opacity-50"
                      >
                        <Checkbox disabled checked={false} className="h-5 w-5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate">
                            {r.name}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            {getDisabledReason(r)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {recipients.length === 0 && !isLoading && (
                  <div className="px-5 py-12 text-center">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No recipients found
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fixed Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                className="flex-1 h-11"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={localSelectedIds.length === 0}
                className="flex-1 h-11"
              >
                Confirm Recipients
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
