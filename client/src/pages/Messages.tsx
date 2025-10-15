import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MessageSquare, Send, Search, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface CompanyUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profileImageUrl: string | null;
  status: string;
  role: string;
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

interface MessageType {
  id: number;
  conversationId: number;
  senderId: string;
  body: string;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
}

export default function Messages() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedUser, setSelectedUser] = useState<CompanyUser | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const ws = useRef<WebSocket | null>(null);

  // Fetch all company users for messaging
  const { data: companyUsers = [] } = useQuery<CompanyUser[]>({
    queryKey: ["/api/messaging/users"],
    enabled: !!user,
  });

  // Fetch conversations
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
    enabled: !!user,
    refetchInterval: 5000, // Poll for new conversations
  });

  // Fetch messages for selected conversation
  const { data: messages = [] } = useQuery<MessageType[]>({
    queryKey: ["/api/conversations", selectedConversationId, "messages"],
    enabled: !!selectedConversationId,
  });

  // Create or get conversation
  const createConversationMutation = useMutation({
    mutationFn: async (otherUserId: string) => {
      return await apiRequest<{ id: number }>(`/api/conversations`, {
        method: "POST",
        body: JSON.stringify({ otherUserId }),
      });
    },
    onSuccess: (data) => {
      setSelectedConversationId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // Send message
  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!selectedConversationId) return;
      return await apiRequest<MessageType>(
        `/api/conversations/${selectedConversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations", selectedConversationId, "messages"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setMessageBody("");
    },
  });

  // Mark conversation as read
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      return await apiRequest(`/api/conversations/${conversationId}/read`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    },
  });

  // WebSocket connection
  useEffect(() => {
    if (!user) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ type: "auth", userId: user.id }));
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "new_message") {
        // Invalidate conversations and messages
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        if (data.conversationId === selectedConversationId) {
          queryClient.invalidateQueries({
            queryKey: ["/api/conversations", selectedConversationId, "messages"],
          });
        }
      }
    };

    return () => {
      ws.current?.close();
    };
  }, [user, selectedConversationId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark conversation as read when selected
  useEffect(() => {
    if (selectedConversationId) {
      markAsReadMutation.mutate(selectedConversationId);
    }
  }, [selectedConversationId]);

  const handleUserSelect = (selectedUser: CompanyUser) => {
    setSelectedUser(selectedUser);
    
    // Check if conversation already exists
    const existingConv = conversations.find(
      (c) => c.otherUser?.id === selectedUser.id
    );

    if (existingConv) {
      setSelectedConversationId(existingConv.id);
    } else {
      // Create new conversation
      createConversationMutation.mutate(selectedUser.id);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageBody.trim() || !selectedConversationId) return;
    sendMessageMutation.mutate(messageBody);
  };

  const filteredUsers = companyUsers.filter((u) =>
    `${u.firstName} ${u.lastName} ${u.email}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const getInitials = (user: CompanyUser) => {
    return `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || user.email[0].toUpperCase();
  };

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);
  const displayUser = selectedUser || selectedConversation?.otherUser;

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Left Sidebar - People List */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold mb-3">Messages</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              data-testid="input-search-users"
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {filteredUsers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <User className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No users found</p>
              </div>
            ) : (
              filteredUsers.map((u) => {
                const conv = conversations.find((c) => c.otherUser?.id === u.id);
                const isSelected = selectedUser?.id === u.id || selectedConversation?.otherUser?.id === u.id;
                
                return (
                  <button
                    key={u.id}
                    data-testid={`button-select-user-${u.id}`}
                    onClick={() => handleUserSelect(u)}
                    className={cn(
                      "w-full p-3 rounded-lg hover:bg-accent transition-colors text-left flex items-start gap-3",
                      isSelected && "bg-accent"
                    )}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={u.profileImageUrl || undefined} />
                      <AvatarFallback>{getInitials(u)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm truncate">
                          {u.firstName} {u.lastName}
                        </p>
                        {conv?.unreadCount ? (
                          <Badge 
                            data-testid={`badge-unread-count-${u.id}`}
                            variant="default" 
                            className="ml-2 h-5 min-w-[20px] flex items-center justify-center text-xs"
                          >
                            {conv.unreadCount}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {conv?.lastMessage?.body || u.email}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right Pane - Chat Thread */}
      <div className="flex-1 flex flex-col">
        {displayUser ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-border flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={displayUser.profileImageUrl || undefined} />
                <AvatarFallback>{getInitials(displayUser)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold" data-testid={`text-chat-header-${displayUser.id}`}>
                  {displayUser.firstName} {displayUser.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{displayUser.email}</p>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOwn = msg.senderId === user?.id;
                    return (
                      <div
                        key={msg.id}
                        data-testid={`message-${msg.id}`}
                        className={cn(
                          "flex",
                          isOwn ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[70%] rounded-lg px-4 py-2",
                            isOwn
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                          <p className="text-xs mt-1 opacity-70">
                            {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Message Input */}
            <div className="p-4 border-t border-border">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <Input
                  data-testid="input-message-body"
                  placeholder="Type a message..."
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  disabled={sendMessageMutation.isPending}
                  className="flex-1"
                />
                <Button 
                  data-testid="button-send-message"
                  type="submit" 
                  disabled={!messageBody.trim() || sendMessageMutation.isPending}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium mb-1">Select a conversation</p>
              <p className="text-sm">Choose a person from the list to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
