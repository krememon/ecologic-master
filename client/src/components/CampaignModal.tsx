import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Mail, MessageSquare, Send, Users, Loader2 } from "lucide-react";

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

  const getAudienceLabel = () => {
    if (audienceMode === "all") {
      return "All Clients";
    }
    return `Selected Clients (${selectedCustomerIds.length})`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Launch Campaign
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Audience: {getAudienceLabel()}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channel</Label>
            <RadioGroup
              value={channel}
              onValueChange={(value) => {
                setChannel(value as Channel);
                setPreview(null);
              }}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="email" id="email" />
                <Label htmlFor="email" className="flex items-center gap-1 cursor-pointer">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="sms" id="sms" />
                <Label htmlFor="sms" className="flex items-center gap-1 cursor-pointer">
                  <MessageSquare className="h-4 w-4" />
                  Text
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="both" id="both" />
                <Label htmlFor="both" className="cursor-pointer">Both</Label>
              </div>
            </RadioGroup>
          </div>

          {(channel === "email" || channel === "both") && (
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Enter email subject..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="body">Message</Label>
            <Textarea
              id="body"
              placeholder={channel === "sms" ? "Enter text message (160 chars recommended)..." : "Enter message body..."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
            {(channel === "sms" || channel === "both") && (
              <p className={`text-xs ${body.length > 160 ? 'text-amber-500' : 'text-slate-500'}`}>
                {body.length} characters • {Math.ceil(body.length / 160) || 1} SMS segment{Math.ceil(body.length / 160) !== 1 ? 's' : ''}
                {body.length > 160 && ' (longer messages may incur extra charges)'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={previewLoading}
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Users className="h-4 w-4 mr-1" />
              )}
              Preview Recipients
            </Button>

            {preview && (
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {channel === "email" && (
                  <span>{preview.emailCount} email recipient{preview.emailCount !== 1 ? 's' : ''}</span>
                )}
                {channel === "sms" && (
                  <span>{preview.smsCount} SMS recipient{preview.smsCount !== 1 ? 's' : ''}</span>
                )}
                {channel === "both" && (
                  <span>
                    {preview.emailCount} email, {preview.smsCount} SMS
                  </span>
                )}
              </div>
            )}
          </div>

          {preview && getEligibleCount() === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No eligible recipients. Clients must have opt-in enabled and valid contact info.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sendMutation.isPending || (preview ? getEligibleCount() === 0 : false)}
          >
            {sendMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-1.5" />
                Send Campaign
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
