import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, Building2 } from "lucide-react";

export default function JoinCompany() {
  const [, setLocation] = useLocation();
  const [inviteCode, setInviteCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const { toast } = useToast();

  const handleJoinCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
      const res = await apiRequest("POST", "/api/join-company", {
        inviteCode: inviteCode.trim(),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to join company");
      }

      // Invalidate all queries to refresh data with new company
      queryClient.invalidateQueries();
      
      toast({
        title: "Success",
        description: "You've joined the company successfully!",
      });

      // Redirect to dashboard
      setLocation("/");
    } catch (error: any) {
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
          <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-2">
            <Building2 className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-2xl">Join a Company</CardTitle>
          <CardDescription>
            You need to join a company to access EcoLogic. Enter your company's invite code below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoinCompany} className="space-y-4">
            <div>
              <Label htmlFor="inviteCode">Company Invite Code *</Label>
              <Input
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="Enter your company's invite code"
                className="uppercase"
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
