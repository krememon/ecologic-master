import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Users, LogOut, AlertTriangle, ArrowLeft } from "lucide-react";

export default function JoinCompany() {
  const [, setLocation] = useLocation();
  const [inviteCode, setInviteCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [seatLimitReached, setSeatLimitReached] = useState(false);
  const { toast } = useToast();
  const { user, isLoading } = useAuth();

  // Guard: redirect users who already have a company
  useEffect(() => {
    if (!isLoading && user?.company) {
      setLocation("/", { replace: true });
    }
  }, [user, isLoading, setLocation]);

  // Show loading spinner while checking auth or redirecting users with company
  if (isLoading || user?.company) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">
            {user?.company ? "Redirecting to dashboard..." : "Loading..."}
          </p>
        </div>
      </div>
    );
  }

  const handleJoinCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSeatLimitReached(false);
    
    if (!inviteCode.trim()) {
      toast({
        title: "Error",
        description: "Please enter a company invite code",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(true);
    
    try {
      console.log("[join-company] submitting invite code");
      const res = await apiRequest("POST", "/api/join-company", {
        inviteCode: inviteCode.trim(),
      });

      if (!res.ok) {
        const error = await res.json();
        if (error.code === 'SEAT_LIMIT_REACHED') {
          setSeatLimitReached(true);
          return;
        }
        throw new Error(error.message || "Failed to join company");
      }

      console.log("[join-company] success — hard-navigating to dashboard to ensure fresh auth state");
      localStorage.removeItem("onboardingChoice");

      // Hard navigation forces the React app to start fresh so the new
      // company membership is fetched cleanly — prevents stale-cache routing
      // from sending the user back to the choice screen.
      window.location.href = "/";
    } catch (error: any) {
      console.error("[join-company] failed:", error.message);
      toast({
        title: "Error",
        description: error.message || "Failed to join company",
        variant: "destructive",
      });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="self-start mb-1">
            <button
              type="button"
              onClick={() => setLocation("/onboarding/choice")}
              className="flex items-center text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </button>
          </div>
          <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center mb-2">
            <Users className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl">Join a Company</CardTitle>
          <CardDescription>
            You need to join a company to access EcoLogic. Enter your company's invite code below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {seatLimitReached ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    Company has reached max employees
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                    The company you're trying to join is at full capacity. Ask your manager to upgrade their plan before trying again.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSeatLimitReached(false);
                  setInviteCode("");
                }}
              >
                Try a Different Code
              </Button>
            </div>
          ) : (
            <form onSubmit={handleJoinCompany} className="space-y-4">
              <div>
                <Label htmlFor="inviteCode">Company Invite Code *</Label>
                <Input
                  id="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Enter code"
                  data-testid="input-invite-code"
                  required
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Ask your company administrator for the invite code
                </p>
              </div>

              <Button 
                type="submit" 
                className="w-full"
                disabled={isJoining}
                data-testid="button-join-company"
              >
                <Users className="h-4 w-4 mr-2" />
                {isJoining ? "Joining..." : "Join Company"}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => window.location.href = '/api/logout'}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                  data-testid="button-sign-out"
                >
                  <LogOut className="h-3 w-3" />
                  Sign out (wrong account?)
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
