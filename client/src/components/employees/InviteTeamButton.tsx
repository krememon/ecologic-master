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
  const [showCode, setShowCode] = useState<string | null>(null);

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

      const result = await copyTextWithDetails(inviteCode);

      if (result.ok) {
        setIsCopied(true);
        setShowCode(null);
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
        setShowCode(inviteCode);
        toast({
          title: "Copy not available",
          description: "Tap and hold the code to copy",
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
    <div className="flex items-center gap-2">
      {showCode && (
        <span
          className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm font-mono text-slate-800 dark:text-slate-200 select-all"
          style={{ WebkitUserSelect: "text", userSelect: "all" }}
        >
          {showCode}
        </span>
      )}
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
    </div>
  );
}
