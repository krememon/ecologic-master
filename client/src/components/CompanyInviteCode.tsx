import { useState } from "react";
import { Copy, Check, Users, Shield, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCompanyInviteCode } from "@/hooks/useCompanyInviteCode";
import { formatDistanceToNow } from "date-fns";
import { copyText } from "@/lib/clipboard";

export default function CompanyInviteCode() {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: company, isLoading } = useCompanyInviteCode();

  const copyToClipboard = async () => {
    if (!company?.inviteCode) return;
    
    const success = await copyText(company.inviteCode);
    if (success) {
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Invite code copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast({
        title: "Failed to copy",
        description: "Couldn't copy — tap and hold to copy",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Employee Invite Code
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
            <div className="h-10 bg-slate-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!company?.inviteCode) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Employee Access
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Only Owners and Supervisors can view and share invite codes.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Employee Invite Code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inviteCode">Owners and Supervisors can share this code with employees to join your company:</Label>
          <div className="flex gap-2">
            <Input
              id="inviteCode"
              value={company.inviteCode}
              readOnly
              className="font-mono text-lg"
            />
            <Button
              onClick={copyToClipboard}
              variant="outline"
              size="icon"
              className="shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        
        <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg space-y-2">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>How it works:</strong> Employees use this code during registration to join your company. 
            They'll have access to view assigned tasks but cannot create jobs, invoices, or manage company settings.
          </p>
          {company.inviteCodeRotatedAt && (
            <p className="text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1">
              <RotateCw className="h-3 w-3" />
              Auto-rotates after each employee joins • Last rotated {formatDistanceToNow(new Date(company.inviteCodeRotatedAt), { addSuffix: true })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}