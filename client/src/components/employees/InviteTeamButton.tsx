import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { Clipboard } from "@capacitor/clipboard";

export default function InviteTeamButton() {
  const { can } = useCan();
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  if (!can("org.view")) {
    return null;
  }

  const copyToClipboard = async (text: string): Promise<boolean> => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Clipboard.write({ string: text });
        return true;
      } catch {
        return false;
      }
    }

    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
      }
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const result = document.execCommand("copy");
      document.body.removeChild(textarea);
      return result;
    } catch {
      return false;
    }
  };

  const handleClick = async () => {
    if (isDisabled) return;

    setIsDisabled(true);

    try {
      // Fetch invite code from API (fresh on every click)
      const response = await fetch("/api/company/info");
      
      if (!response.ok) {
        // If 403, user lost permission - component will unmount on next render
        if (response.status === 403) {
          return;
        }
        throw new Error("Failed to fetch invite code");
      }

      const data = await response.json();
      const inviteCode = data.inviteCode;

      if (!inviteCode) {
        throw new Error("No invite code available");
      }

      // Copy to clipboard
      const success = await copyToClipboard(inviteCode);

      if (success) {
        setIsCopied(true);
        toast({
          description: "Company code copied to clipboard",
        });

        // Revert label after exactly 2000ms
        setTimeout(() => {
          setIsCopied(false);
          setIsDisabled(false);
        }, 2000);
      } else {
        throw new Error("Failed to copy to clipboard");
      }
    } catch (error) {
      setIsDisabled(false);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to copy invite code",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={isDisabled}
        aria-live="polite"
        data-testid="button-invite-team"
      >
        <Users className="h-4 w-4 mr-2" />
        {isCopied ? "Copied" : "Invite Team"}
      </Button>
    </>
  );
}
