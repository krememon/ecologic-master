import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

interface CompanyUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profileImageUrl: string | null;
  status: string;
  role: string;
  conversationId: number | null;
}

interface Conversation {
  id: number;
  isGroup: boolean;
  createdAt: Date;
  updatedAt: Date;
  otherUser: CompanyUser;
  lastMessage: {
    id: number;
    body: string;
    senderId: string;
    createdAt: Date;
  } | null;
  unreadCount: number;
}

export default function MessagesDirectory() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  // Fetch all company users for messaging (now includes conversationId)
  const { data: companyUsers = [] } = useQuery<CompanyUser[]>({
    queryKey: ["/api/messaging/users"],
    enabled: !!user,
  });

  // Fetch conversations to show unread counts
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    enabled: !!user,
    refetchInterval: 5000,
    select: (data: any) => {
      return data.map((conv: any) => ({
        ...conv,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt),
        lastMessage: conv.lastMessage ? {
          ...conv.lastMessage,
          createdAt: new Date(conv.lastMessage.createdAt),
        } : null,
      }));
    },
  });


  const filteredUsers = companyUsers.filter((u) =>
    `${u.firstName} ${u.lastName} ${u.email}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const getInitials = (user: CompanyUser) => {
    return `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || user.email[0].toUpperCase();
  };

  const handleUserTap = (clickedUser: CompanyUser) => {
    // Navigate instantly to user route via browser navigation - server will handle get-or-create and 302 redirect
    window.location.href = `/messages/u/${clickedUser.id}`;
  };

  // Prefetch conversation messages on hover
  const handleUserHover = (clickedUser: CompanyUser) => {
    if (clickedUser.conversationId) {
      queryClient.prefetchQuery({
        queryKey: ["/api/conversations", clickedUser.conversationId, "messages"],
      });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h1 className="text-2xl font-semibold mb-4">Messages</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            data-testid="input-search-people"
            placeholder="Search people..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* People List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {filteredUsers.length === 0 ? (
            <div className="text-center text-muted-foreground py-16">
              <User className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No users found</p>
            </div>
          ) : (
            filteredUsers.map((u) => {
              const conv = conversations.find((c) => c.otherUser?.id === u.id);
              
              return (
                <button
                  key={u.id}
                  data-testid={`button-user-${u.id}`}
                  onClick={() => handleUserTap(u)}
                  onMouseEnter={() => handleUserHover(u)}
                  onTouchStart={() => handleUserHover(u)}
                  className="w-full px-4 py-3 hover:bg-accent transition-colors text-left flex items-center gap-3 min-h-[60px]"
                >
                  <Avatar className="h-12 w-12 flex-shrink-0">
                    <AvatarImage src={u.profileImageUrl || undefined} />
                    <AvatarFallback className="text-base font-medium">
                      {getInitials(u)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="font-semibold text-base truncate">
                        {u.firstName} {u.lastName}
                      </p>
                      {conv?.unreadCount ? (
                        <Badge 
                          data-testid={`badge-unread-${u.id}`}
                          variant="default" 
                          className="ml-2 h-5 min-w-[20px] flex items-center justify-center text-xs shrink-0"
                        >
                          {conv.unreadCount}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground truncate capitalize">
                      {u.role?.replace('_', ' ') || 'Member'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
