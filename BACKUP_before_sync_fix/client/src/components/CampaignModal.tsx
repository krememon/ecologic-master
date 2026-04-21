import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send, Users, Loader2, X, ChevronRight, AlertTriangle } from "lucide-react";
import RecipientPreviewModal from "./RecipientPreviewModal";

type AudienceMode = "selected" | "all";

interface Recipient {
  id: number;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  emailEligible: boolean;
  smsEligible: boolean;
  emailDisabledReason: string | null;
  smsDisabledReason: string | null;
  emailUnsubscribed?: boolean;
  smsUnsubscribed?: boolean;
}

interface CampaignModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCustomerIds: number[];
  audienceMode?: AudienceMode;
  onSendSuccess?: () => void;
}

export default function CampaignModal({ 
  open, 
  onOpenChange, 
  selectedCustomerIds, 
  audienceMode = "selected",
  onSendSuccess 
}: CampaignModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientModalOpen, setRecipientModalOpen] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [campaignRecipientIds, setCampaignRecipientIds] = useState<number[]>([]);
  const [recipientsLoaded, setRecipientsLoaded] = useState(false);
  const [showUnsubscribedWarning, setShowUnsubscribedWarning] = useState(false);
  const [hasUnsubscribedRecipients, setHasUnsubscribedRecipients] = useState(false);

  const isAdmin = user?.role === 'OWNER' || user?.role === 'SUPERVISOR';

  useEffect(() => {
    if (open) {
      setRecipients([]);
      setCampaignRecipientIds([]);
      setRecipientsLoaded(false);
    }
  }, [open]);

  const fetchRecipientsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaigns/recipients", {
        customerIds: audienceMode === "all" ? [] : selectedCustomerIds,
        channel: "email",
        audienceMode,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setRecipients(data.recipients);
      const eligibleIds = data.recipients
        .filter((r: Recipient) => r.emailEligible)
        .map((r: Recipient) => r.id);
      
      if (!recipientsLoaded) {
        setCampaignRecipientIds(eligibleIds);
        setRecipientsLoaded(true);
      }
      setRecipientModalOpen(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaigns/send", {
        customerIds: campaignRecipientIds.length > 0 ? campaignRecipientIds : (audienceMode === "all" ? [] : selectedCustomerIds),
        channel: "email",
        subject,
        emailBody: body,
        audienceMode: campaignRecipientIds.length > 0 ? "selected" : audienceMode,
        includeUnsubscribed: hasUnsubscribedRecipients,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const totalSent = data.emailSent || 0;
      const totalFailed = data.emailFailed || 0;
      if (totalSent === 0 && totalFailed > 0) {
        toast({
          title: "Campaign Failed",
          description: `All ${totalFailed} email${totalFailed !== 1 ? 's' : ''} failed to send.`,
          variant: "destructive",
        });
      } else if (totalFailed > 0) {
        toast({
          title: "Campaign Partially Sent",
          description: `Sent ${totalSent}, failed ${totalFailed} email${totalFailed !== 1 ? 's' : ''}.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Campaign Sent",
          description: `Successfully sent ${totalSent} email${totalSent !== 1 ? 's' : ''}.`,
        });
      }
      onOpenChange(false);
      resetForm();
      onSendSuccess?.();
    },
    onError: (error: any) => {
      console.error("[Campaign] Send error:", error);
      let title = "Send Error";
      let description = "Failed to send campaign";
      
      try {
        const errStr = error?.message || "";
        const jsonMatch = errStr.match(/^\d+:\s*(.+)/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.error === "NO_ELIGIBLE_RECIPIENTS") {
            title = "No Eligible Recipients";
            description = parsed.message || description;
          } else {
            description = parsed.message || description;
          }
        }
      } catch {}
      
      toast({ title, description, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSubject("");
    setBody("");
    setRecipients([]);
    setCampaignRecipientIds([]);
    setRecipientsLoaded(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const handlePreviewRecipients = () => {
    fetchRecipientsMutation.mutate();
  };

  const handleRecipientConfirm = (ids: number[], hasUnsubscribedOverrides: boolean) => {
    setCampaignRecipientIds(ids);
    setHasUnsubscribedRecipients(hasUnsubscribedOverrides);
  };

  const handleSendClick = () => {
    if (hasUnsubscribedRecipients) {
      setShowUnsubscribedWarning(true);
    } else {
      handleSend();
    }
  };

  const handleSend = () => {
    if (!subject.trim()) {
      toast({
        title: "Subject Required",
        description: "Please enter an email subject.",
        variant: "destructive",
      });
      return;
    }
    if (!body.trim()) {
      toast({
        title: "Message Required",
        description: "Please enter a message body.",
        variant: "destructive",
      });
      return;
    }
    sendMutation.mutate();
  };

  const getPreviewLabel = () => {
    if (audienceMode === "selected" && selectedCustomerIds.length > 0) {
      return "Preview selected recipients";
    }
    return "Preview recipients";
  };

  const getRecipientSummary = () => {
    if (!recipientsLoaded) return null;
    const emailCount = campaignRecipientIds.filter((id) => {
      const r = recipients.find((rec) => rec.id === id);
      return r?.emailEligible;
    }).length;
    return `${emailCount} email`;
  };

  const canSend = () => {
    if (!subject.trim()) return false;
    if (!body.trim()) return false;
    if (recipientsLoaded && campaignRecipientIds.length === 0) return false;
    return true;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-[95vw] max-w-md p-0 gap-0 rounded-2xl overflow-hidden [&>button]:hidden">
          <div className="flex flex-col h-full max-h-[85vh]">
            {/* Fixed Header */}
            <div className="flex items-center justify-center h-14 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative flex-shrink-0">
              <button 
                type="button"
                onClick={() => handleOpenChange(false)} 
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <X className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              </button>
              <div className="text-center">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-center gap-2">
                  <Send className="h-4 w-4" />
                  Launch Campaign
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Send an email campaign to your clients</p>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="px-5 py-4 flex-1 overflow-auto">
              <div className="space-y-4">
                {/* Subject */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Subject</label>
                  <Input
                    placeholder="Enter email subject..."
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="h-10 text-sm"
                  />
                </div>

                {/* Email Message */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Email Message</label>
                  <Textarea
                    placeholder="Enter your message..."
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="text-sm min-h-[100px] resize-none"
                  />
                </div>

                {/* Preview Recipients Row */}
                <div 
                  onClick={handlePreviewRecipients}
                  className="flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {fetchRecipientsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                    ) : (
                      <Users className="h-4 w-4 text-blue-600" />
                    )}
                    <span className="text-sm font-medium text-blue-600">{getPreviewLabel()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {recipientsLoaded && (
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        {getRecipientSummary()}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                </div>

                {recipientsLoaded && campaignRecipientIds.length === 0 && (
                  <div className="text-sm text-amber-600 dark:text-amber-400 px-1 space-y-1">
                    <p className="font-medium">No eligible recipients found.</p>
                    {(() => {
                      const noEmail = recipients.filter(r => r.emailDisabledReason === "No email").length;
                      const emailOptedOut = recipients.filter(r => r.emailDisabledReason === "Not opted in" || r.emailDisabledReason === "Unsubscribed").length;
                      return (noEmail > 0 || emailOptedOut > 0) ? (
                        <ul className="text-xs list-disc list-inside">
                          {noEmail > 0 && <li>{noEmail} client{noEmail !== 1 ? 's' : ''} missing email addresses</li>}
                          {emailOptedOut > 0 && <li>{emailOptedOut} client{emailOptedOut !== 1 ? 's' : ''} opted out of email</li>}
                        </ul>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => handleOpenChange(false)} 
                  className="flex-1 h-11"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendClick}
                  disabled={sendMutation.isPending || !canSend()}
                  className="flex-1 h-11"
                >
                  {sendMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send Campaign
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RecipientPreviewModal
        open={recipientModalOpen}
        onOpenChange={setRecipientModalOpen}
        channel="email"
        recipients={recipients}
        selectedIds={campaignRecipientIds}
        onConfirm={handleRecipientConfirm}
        isLoading={fetchRecipientsMutation.isPending}
        isAdmin={isAdmin}
      />

      <AlertDialog open={showUnsubscribedWarning} onOpenChange={setShowUnsubscribedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Sending to Unsubscribed Recipients
            </AlertDialogTitle>
            <AlertDialogDescription>
              One or more selected recipients have unsubscribed from marketing emails. 
              Are you sure you want to send to them anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setShowUnsubscribedWarning(false);
              handleSend();
            }}>
              Send Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
