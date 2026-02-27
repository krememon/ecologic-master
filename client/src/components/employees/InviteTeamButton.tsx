import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { useToast } from "@/hooks/use-toast";
import { copyTextWithDetails } from "@/lib/clipboard";

export default function InviteTeamButton() {
  const { can } = useCan();
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  if (!can("org.view")) {
    return null;
  }

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

      const result = await copyTextWithDetails(inviteCode);

      if (result.ok) {
        setIsCopied(true);
        const devSuffix = import.meta.env.DEV ? ` (${result.method})` : "";
        toast({
          description: `Company code copied to clipboard${devSuffix}`,
        });

        setTimeout(() => {
          setIsCopied(false);
          setIsDisabled(false);
        }, 2000);
      } else {
        setIsDisabled(false);
        toast({
          title: "Couldn't copy automatically",
          description: `Your code: ${inviteCode} — tap and hold to copy`,
          duration: 8000,
        });
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
