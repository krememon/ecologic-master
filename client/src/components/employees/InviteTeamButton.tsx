import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useCan } from "@/hooks/useCan";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/clipboard";

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
      const response = await fetch("/api/company/info");
      
      if (!response.ok) {
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

      const success = await copyText(inviteCode);

      if (success) {
        setIsCopied(true);
        toast({
          description: "Company code copied to clipboard",
        });

        setTimeout(() => {
          setIsCopied(false);
          setIsDisabled(false);
        }, 2000);
      } else {
        setIsDisabled(false);
      }
    } catch (error) {
      setIsDisabled(false);
    }
  };

  return (
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
  );
}
