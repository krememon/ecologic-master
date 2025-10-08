import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { useToast } from "@/hooks/use-toast";

export default function InviteTeamButton() {
  const { can } = useCan();
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Don't render if user lacks permission
  if (!can("org.view")) {
    return null;
  }

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // Try modern clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // Fall through to fallback
      }
    }

    // Fallback for older browsers or insecure contexts
    try {
      const textarea = textareaRef.current;
      if (!textarea) return false;

      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-999999px";
      textarea.style.top = "-999999px";
      textarea.select();
      document.execCommand("copy");
      textarea.value = "";
      return true;
    } catch (err) {
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
      {/* Hidden textarea for clipboard fallback */}
      <textarea
        ref={textareaRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-999999px",
          top: "-999999px",
          opacity: 0,
          pointerEvents: "none",
        }}
        tabIndex={-1}
      />
    </>
  );
}
