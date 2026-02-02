import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, X, Users, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || '';
  const last = lastName?.charAt(0)?.toUpperCase() || '';
  return first + last || '?';
}

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

export function AnnouncementModal({ open, onOpenChange }: AnnouncementModalProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: members = [], isLoading: membersLoading } = useQuery<CompanyMember[]>({
    queryKey: ["/api/employees"],
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/announcements", {
        message,
        roleTargets: [],
        userTargets: selectedUsers,
        sendToAll: false,
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
    setSelectedUsers([]);
    setSearchQuery("");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleUserToggle = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId) ? prev.filter((u) => u !== userId) : [...prev, userId]
    );
  };

  const handleClearSelection = () => {
    setSelectedUsers([]);
  };

  const canSend = message.trim().length > 0 && selectedUsers.length > 0;

  const getMemberName = (member: CompanyMember) => {
    const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(" ");
    return name || member.user.email;
  };

  const nonOwnerMembers = members.filter((m) => m.role !== "OWNER");

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return nonOwnerMembers;
    const query = searchQuery.toLowerCase();
    return nonOwnerMembers.filter((m) => {
      const fullName = getMemberName(m).toLowerCase();
      return fullName.includes(query) || 
             m.user.email?.toLowerCase().includes(query) ||
             m.role.toLowerCase().includes(query);
    });
  }, [nonOwnerMembers, searchQuery]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md p-0 gap-0 overflow-hidden rounded-2xl" preventAutoFocus hideCloseButton>
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="min-w-[44px]" />
          <DialogTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Create Announcement
          </DialogTitle>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-end"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-white dark:bg-slate-900">
          <div className="px-4 py-4">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
              Message
            </label>
            <Textarea
              placeholder="Type your announcement..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[80px] bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0 resize-none"
              maxLength={1000}
            />
            <p className="text-xs text-slate-400 mt-1.5 text-right">
              {message.length}/1000
            </p>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Recipients
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  Selected: {selectedUsers.length}
                </span>
                {selectedUsers.length > 0 && (
                  <button
                    onClick={handleClearSelection}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search employees..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl text-sm placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-0"
              />
            </div>

            <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
              <ScrollArea className="max-h-48">
                {membersLoading ? (
                  <div className="py-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3.5 w-24 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                          <div className="h-3 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4">
                    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2">
                      <Users className="h-6 w-6 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                      {searchQuery ? "No employees match your search" : "No employees found"}
                    </p>
                  </div>
                ) : (
                  <div>
                    {filteredMembers.map((member, index) => {
                      const isSelected = selectedUsers.includes(member.userId);
                      return (
                        <div key={member.userId}>
                          <button
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 active:bg-slate-100 dark:active:bg-slate-800 transition-colors"
                            onClick={() => handleUserToggle(member.userId)}
                          >
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-600 dark:to-slate-700 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                              {getInitials(member.user.firstName, member.user.lastName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {getMemberName(member)}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {formatRole(member.role)}
                              </p>
                            </div>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                              isSelected 
                                ? "bg-blue-600 text-white" 
                                : "border-2 border-slate-300 dark:border-slate-600"
                            }`}>
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>
                          </button>
                          {index < filteredMembers.length - 1 && (
                            <div className="h-px bg-slate-100 dark:bg-slate-800 ml-[60px] mr-3" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          <div className="flex gap-3 p-4">
            <Button 
              variant="outline" 
              onClick={handleClose}
              className="flex-1 h-11 rounded-xl border-slate-200 dark:border-slate-700"
            >
              Cancel
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
              className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
