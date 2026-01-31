import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Mail, MessageSquare, Send, Users, Loader2, X } from "lucide-react";

type Channel = "email" | "sms" | "both";
type AudienceMode = "selected" | "all";

interface CampaignPreview {
  emailCount: number;
  smsCount: number;
  totalSelected: number;
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
  const [channel, setChannel] = useState<Channel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setPreview(null);
    }
  }, [open, audienceMode, selectedCustomerIds.length]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      setPreviewLoading(true);
      const res = await apiRequest("POST", "/api/campaigns/preview", {
        customerIds: audienceMode === "all" ? [] : selectedCustomerIds,
        channel,
        audienceMode,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      setPreviewLoading(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Preview Error",
        description: error.message,
        variant: "destructive",
      });
      setPreviewLoading(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/campaigns/send", {
        customerIds: audienceMode === "all" ? [] : selectedCustomerIds,
        channel,
        subject: channel === "email" || channel === "both" ? subject : undefined,
        emailBody: channel === "email" || channel === "both" ? body : undefined,
        smsBody: channel === "sms" || channel === "both" ? body : undefined,
        audienceMode,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const totalSent = (data.emailSent || 0) + (data.smsSent || 0);
      toast({
        title: "Campaign Sent",
        description: `Successfully sent ${totalSent} message${totalSent !== 1 ? 's' : ''}.`,
      });
      onOpenChange(false);
      resetForm();
      onSendSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Send Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setChannel("email");
    setSubject("");
    setBody("");
    setPreview(null);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
    }
    onOpenChange(open);
  };

  const handlePreview = () => {
    previewMutation.mutate();
  };

  const handleSend = () => {
    if ((channel === "email" || channel === "both") && !subject.trim()) {
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

  const getEligibleCount = () => {
    if (!preview) return 0;
    if (channel === "email") return preview.emailCount;
    if (channel === "sms") return preview.smsCount;
    return preview.emailCount + preview.smsCount;
  };

  const getPreviewLabel = () => {
    if (audienceMode === "selected" && selectedCustomerIds.length > 0) {
      return "Preview selected recipients";
    }
    return "Preview recipients";
  };

  const getMessageLabel = () => {
    if (channel === "email") return "Email Message";
    if (channel === "sms") return "Text Message";
    return "Message";
  };

  const canSend = () => {
    if ((channel === "email" || channel === "both") && !subject.trim()) return false;
    if (!body.trim()) return false;
    return true;
  };

  return (
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
              <p className="text-xs text-slate-500 dark:text-slate-400">Send an email, text, or both to your clients</p>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="px-5 py-4 flex-1 overflow-auto">
            <div className="space-y-4">
              {/* Channel Segmented Control */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Channel</label>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-800/50">
                  <button
                    type="button"
                    onClick={() => { setChannel("email"); setPreview(null); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                      channel === "email"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => { setChannel("sms"); setPreview(null); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                      channel === "sms"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Text
                  </button>
                  <button
                    type="button"
                    onClick={() => { setChannel("both"); setPreview(null); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                      channel === "both"
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    Both
                  </button>
                </div>
              </div>

              {/* Subject Field (Email or Both) */}
              {(channel === "email" || channel === "both") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Subject</label>
                  <Input
                    placeholder="Enter email subject..."
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="h-10 text-sm"
                  />
                </div>
              )}

              {/* Message Field */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">{getMessageLabel()}</label>
                <Textarea
                  placeholder={channel === "sms" ? "Enter your text message..." : "Enter your message..."}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="text-sm min-h-[100px] resize-none"
                />
                {(channel === "sms" || channel === "both") && (
                  <p className={`text-xs ${body.length > 160 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    {body.length} characters • {Math.ceil(body.length / 160) || 1} SMS segment{Math.ceil(body.length / 160) !== 1 ? 's' : ''}
                    {body.length > 160 && ' (extra charges may apply)'}
                  </p>
                )}
              </div>

              {/* Preview Recipients Row */}
              <div 
                onClick={handlePreview}
                className="flex items-center justify-between px-3 py-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {previewLoading ? (
                    <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                  ) : (
                    <Users className="h-4 w-4 text-blue-600" />
                  )}
                  <span className="text-sm font-medium text-blue-600">{getPreviewLabel()}</span>
                </div>
                {preview && (
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {channel === "email" && `${preview.emailCount} email`}
                    {channel === "sms" && `${preview.smsCount} text`}
                    {channel === "both" && `${preview.emailCount} email • ${preview.smsCount} text`}
                  </span>
                )}
              </div>

              {/* Warning if no eligible recipients */}
              {preview && getEligibleCount() === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400 px-1">
                  No eligible recipients. Clients must have opt-in enabled and valid contact info.
                </p>
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
                onClick={handleSend}
                disabled={sendMutation.isPending || !canSend() || (preview ? getEligibleCount() === 0 : false)}
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
  );
}
