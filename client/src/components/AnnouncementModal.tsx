import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Megaphone, Users, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AnnouncementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CompanyMember {
  userId: string;
  role: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
  };
}

const AVAILABLE_ROLES = [
  { id: "SUPERVISOR", label: "Supervisor" },
  { id: "DISPATCHER", label: "Dispatcher" },
  { id: "ESTIMATOR", label: "Estimator" },
  { id: "TECHNICIAN", label: "Technician" },
];

export function AnnouncementModal({ open, onOpenChange }: AnnouncementModalProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [sendToAll, setSendToAll] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const { data: members = [], isLoading: membersLoading } = useQuery<CompanyMember[]>({
    queryKey: ["/api/employees"],
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/announcements", {
        message,
        roleTargets: selectedRoles,
        userTargets: selectedUsers,
        sendToAll,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to send announcement");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Announcement sent",
        description: `Sent to ${data.recipientCount} recipient${data.recipientCount !== 1 ? "s" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setMessage("");
    setSendToAll(false);
    setSelectedRoles([]);
    setSelectedUsers([]);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleRoleToggle = (role: string) => {
    if (sendToAll) return;
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleUserToggle = (userId: string) => {
    if (sendToAll) return;
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
    );
  };

  const handleSendToAllToggle = (checked: boolean) => {
    setSendToAll(checked);
    if (checked) {
      setSelectedRoles([]);
      setSelectedUsers([]);
    }
  };

  const canSend = message.trim().length > 0 && (sendToAll || selectedRoles.length > 0 || selectedUsers.length > 0);

  const getMemberName = (member: CompanyMember) => {
    const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(" ");
    return name || member.user.email;
  };

  const nonOwnerMembers = members.filter((m) => m.role !== "OWNER");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-amber-500" />
            Create Announcement
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label htmlFor="announcement-text">Message</Label>
            <Textarea
              id="announcement-text"
              placeholder="Type your announcement..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1.5 min-h-[100px]"
              maxLength={1000}
            />
            <p className="text-xs text-slate-400 mt-1 text-right">
              {message.length}/1000
            </p>
          </div>

          <div className="space-y-3">
            <Label>Recipients</Label>

            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <Checkbox
                id="send-to-all"
                checked={sendToAll}
                onCheckedChange={handleSendToAllToggle}
              />
              <Label htmlFor="send-to-all" className="cursor-pointer font-medium text-amber-800 dark:text-amber-200">
                Send to All Employees
              </Label>
            </div>

            <div className={sendToAll ? "opacity-50 pointer-events-none" : ""}>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">By Role</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {AVAILABLE_ROLES.map((role) => (
                  <div key={role.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`role-${role.id}`}
                      checked={selectedRoles.includes(role.id)}
                      onCheckedChange={() => handleRoleToggle(role.id)}
                      disabled={sendToAll}
                    />
                    <Label htmlFor={`role-${role.id}`} className="cursor-pointer text-sm">
                      {role.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className={sendToAll ? "opacity-50 pointer-events-none" : ""}>
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Specific People</span>
              </div>
              {membersLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : nonOwnerMembers.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">No employees found</p>
              ) : (
                <ScrollArea className="h-[120px] border rounded-lg p-2">
                  <div className="space-y-2">
                    {nonOwnerMembers.map((member) => (
                      <div key={member.userId} className="flex items-center gap-2">
                        <Checkbox
                          id={`user-${member.userId}`}
                          checked={selectedUsers.includes(member.userId)}
                          onCheckedChange={() => handleUserToggle(member.userId)}
                          disabled={sendToAll}
                        />
                        <Label htmlFor={`user-${member.userId}`} className="cursor-pointer text-sm flex-1">
                          {getMemberName(member)}
                          <span className="text-xs text-slate-400 ml-2">({member.role})</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Megaphone className="h-4 w-4 mr-2" />
                  Send Announcement
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
