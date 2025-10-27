import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, Send, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { isRenderableMessage, groupByDay, formatDayLabel, formatTime, MessageType as MsgType } from "@/lib/messageUtils";

interface MessageType {
  id: number | string; // Allow string for optimistic IDs
  conversationId?: number;
  senderId: string;
  body: string;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  isPending?: boolean;
  isFailed?: boolean;
}

interface OtherUserType {
  id: string;
  name: string;
  avatar: string | null;
  role: string;
  status: string;
}

interface DMOpenResponse {
  conversation: { id: number };
  otherUser: OtherUserType;
  messages: Array<{
    id: number;
    senderId: string;
    body: string;
    createdAt: string;
  }>;
}

interface MessageThreadProps {
  conversationId: string;
}

export default function MessageThread({ conversationId }: MessageThreadProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [messageBody, setMessageBody] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<MessageType[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ws = useRef<WebSocket | null>(null);

  // Detect if this is a userId or conversationId based on the URL path
  const isUserId = location.startsWith('/messages/u/');
  const numericConvId = !isUserId ? parseInt(conversationId) : null;

  // State for DM data
  const [dmData, setDmData] = useState<DMOpenResponse | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(isUserId);

  // Open DM if navigating via userId
  useEffect(() => {
    if (!isUserId || !user) return;

    const openDM = async () => {
      try {
        setDmLoading(true);
        setDmError(null);
        const response = await apiRequest("POST", "/api/dm/open", { 
          userId: conversationId,
          limit: 50 
        });
        const data: DMOpenResponse = await response.json();
        
        if (!data.conversation?.id) {
          throw new Error("Invalid response from server");
        }

        setDmData(data);
        // Update URL to canonical conversation route
        setLocation(`/messages/c/${data.conversation.id}`, { replace: true });
        // Clear dmData after redirect so component switches to live React Query data
        setTimeout(() => setDmData(null), 100);
      } catch (error: any) {
        console.error("Failed to open DM:", error);
        if (error.message?.includes('403')) {
          setDmError("You don't have access to message this user");
        } else {
          setDmError("Failed to load conversation. Please try again.");
        }
      } finally {
        setDmLoading(false);
      }
    };

    openDM();
  }, [conversationId, isUserId, user]);

  // Fallback to numeric conversation ID flow
  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ["/api/conversations", numericConvId],
    enabled: !!numericConvId && !isNaN(numericConvId!),
  });

  const { data: fetchedMessages = [], isLoading: messagesLoading } = useQuery<MessageType[]>({
    queryKey: ["/api/conversations", numericConvId, "messages"],
    enabled: !!numericConvId && !isNaN(numericConvId!),
    staleTime: 5000,
    placeholderData: [],
    select: (data: any) => {
      return data.map((msg: any) => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
        editedAt: msg.editedAt ? new Date(msg.editedAt) : null,
        deletedAt: msg.deletedAt ? new Date(msg.deletedAt) : null,
      }));
    },
  });

  // Get current conversation ID (either from DM or numeric)
  const currentConvId = dmData?.conversation?.id || numericConvId;

  // Combine fetched messages with optimistic messages
  const messages = dmData 
    ? [...dmData.messages.map(m => ({ ...m, createdAt: new Date(m.createdAt) })), ...optimisticMessages]
    : [...fetchedMessages, ...optimisticMessages];

  // Get other user info
  const otherUser = dmData?.otherUser || (conversation as any)?.otherUser;

  // Determine if data is loaded (either from DM or query)
  const dataLoaded = (dmData !== null && !dmLoading) || (!isUserId && !conversationLoading);

  // Check if recipient is explicitly inactive (only when data is loaded)
  // Only treat as inactive if status is explicitly DEACTIVATED or REMOVED
  // Missing/undefined status is treated as active (tolerant approach)
  const isRecipientInactive = dataLoaded && otherUser && (
    otherUser.status?.toUpperCase() === 'DEACTIVATED' ||
    otherUser.status?.toUpperCase() === 'REMOVED'
  );

  // Composer enable rules
  const canSend = dataLoaded && !isRecipientInactive && !!currentConvId;

  // Send message mutation with optimistic updates
  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!currentConvId) throw new Error("No conversation ID");
      
      const response = await apiRequest(
        "POST",
        `/api/conversations/${currentConvId}/messages`,
        { body }
      );
      return await response.json();
    },
    onMutate: async (body: string) => {
      // Optimistic update
      const optimisticMessage: MessageType = {
        id: `temp-${Date.now()}`,
        senderId: user!.id,
        body,
        createdAt: new Date(),
        isPending: true,
      };
      setOptimisticMessages(prev => [...prev, optimisticMessage]);
      setMessageBody("");
    },
    onSuccess: () => {
      setOptimisticMessages([]);
      if (currentConvId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/conversations", currentConvId, "messages"],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
      textareaRef.current?.focus();
    },
    onError: (error, body) => {
      // Mark last optimistic message as failed
      setOptimisticMessages(prev => 
        prev.map((msg, idx) => 
          idx === prev.length - 1 ? { ...msg, isPending: false, isFailed: true } : msg
        )
      );
      toast({
        title: "Failed to send",
        description: "Message failed to send. Click retry.",
        variant: "destructive",
      });
    },
  });

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!currentConvId) return;
      await apiRequest("POST", `/api/conversations/${currentConvId}/read`);
    },
  });

  // WebSocket connection
  useEffect(() => {
    if (!user || !currentConvId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ type: "auth", userId: user.id }));
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === "new_message" && data.conversationId === currentConvId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/conversations", currentConvId, "messages"],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } else if (data.type === "typing" && data.conversationId === currentConvId) {
        setIsTyping(data.isTyping);
      }
    };

    return () => {
      ws.current?.close();
    };
  }, [user, currentConvId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when opened
  useEffect(() => {
    if (currentConvId) {
      markAsReadMutation.mutate();
    }
  }, [currentConvId]);

  // Auto-focus composer on mount (only if can send)
  useEffect(() => {
    if (canSend && !dmError) {
      textareaRef.current?.focus();
    }
  }, [canSend, dmError]);

  const handleSend = () => {
    if (!messageBody.trim() || !currentConvId) return;
    sendMessageMutation.mutate(messageBody.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };


  // Error state for invalid route
  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Invalid Conversation</h3>
        <p className="text-muted-foreground mb-4">The conversation link is invalid.</p>
        <Button onClick={() => setLocation("/messages")} data-testid="button-back-to-messages">
          Back to Messages
        </Button>
      </div>
    );
  }

  // Error state for DM access denied
  if (dmError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Unable to Load</h3>
        <p className="text-muted-foreground mb-4">{dmError}</p>
        <div className="flex gap-2">
          <Button onClick={() => setLocation("/messages")} variant="outline" data-testid="button-back-to-messages">
            Back to Messages
          </Button>
          <Button onClick={() => window.location.reload()} data-testid="button-retry">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Show header and composer immediately, even while loading
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border bg-card">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/messages")}
          className="md:hidden"
          data-testid="button-back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        
        {otherUser ? (
          <>
            <Avatar className="h-10 w-10" data-testid="avatar-other-user">
              <AvatarImage src={otherUser.avatar || undefined} />
              <AvatarFallback>{getInitials(otherUser.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="font-semibold" data-testid="text-other-user-name">{otherUser.name}</h2>
              <p className="text-xs text-muted-foreground capitalize" data-testid="text-other-user-role">
                {otherUser.role?.toLowerCase()}
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1">
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-3 w-20 bg-muted animate-pulse rounded mt-1" />
          </div>
        )}
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" data-testid="scroll-area-messages">
        {dmLoading || messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-muted-foreground">
            <div>
              <p className="text-sm" data-testid="text-no-messages">
                Start a conversation with {otherUser?.name || 'this user'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {(() => {
              // Filter out empty messages and group by day
              const renderableMessages = messages.filter(isRenderableMessage);
              const days = groupByDay(renderableMessages);

              return days.map(({ day, items }) => (
                <div key={day}>
                  {/* Day separator */}
                  <div className="flex justify-center my-3">
                    <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      {formatDayLabel(day)}
                    </span>
                  </div>

                  {/* Messages for this day */}
                  <div className="space-y-2">
                    {items.map((msg) => {
                      const isCurrentUser = msg.senderId === user?.id;

                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex max-w-[75%]",
                            isCurrentUser ? "ml-auto justify-end" : "mr-auto justify-start"
                          )}
                          data-testid={`message-${msg.id}`}
                        >
                          <div
                            className={cn(
                              "rounded-2xl px-3 py-2 break-words",
                              isCurrentUser
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted",
                              msg.isPending && "opacity-60",
                              msg.isFailed && "opacity-40 border-2 border-destructive"
                            )}
                          >
                            <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                            <p className={cn(
                              "text-[10px] mt-1 text-right",
                              isCurrentUser ? "text-primary-foreground/60" : "text-muted-foreground/60"
                            )}>
                              {msg.isPending ? "Sending..." : msg.isFailed ? "Failed" : formatTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
            {isTyping && (
              <div className="flex gap-2 max-w-[80%] mr-auto">
                <div className="bg-muted rounded-2xl px-4 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Composer */}
      <div className="p-4 border-t border-border bg-card">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            data-testid="textarea-message-input"
            placeholder="Type a message..."
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
            disabled={!canSend}
          />
          <Button
            data-testid="button-send-message"
            onClick={handleSend}
            disabled={!messageBody.trim() || sendMessageMutation.isPending || !canSend}
            size="icon"
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {isRecipientInactive && (
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-inactive-banner">
            This user is inactive and cannot receive messages
          </p>
        )}
      </div>
    </div>
  );
}
