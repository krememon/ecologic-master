import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, Send } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format, isToday, isYesterday, isSameDay } from "date-fns";
import { useLocation } from "wouter";

interface MessageType {
  id: number;
  conversationId: number;
  senderId: string;
  body: string;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
}

interface ConversationDetails {
  id: number;
  isGroup: boolean;
  otherUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    profileImageUrl: string | null;
    status: string;
  };
}

interface MessageThreadProps {
  conversationId: string;
}

export default function MessageThread({ conversationId }: MessageThreadProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [messageBody, setMessageBody] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ws = useRef<WebSocket | null>(null);

  const convId = parseInt(conversationId);

  // Fetch conversation details
  const { data: conversation } = useQuery({
    queryKey: ["/api/conversations", convId],
    enabled: !!convId,
  }) as { data: ConversationDetails | undefined };

  // Fetch messages
  const { data: messages = [] } = useQuery({
    queryKey: ["/api/conversations", convId, "messages"],
    enabled: !!convId,
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (body: string) => {
      const response = await apiRequest(
        "POST",
        `/api/conversations/${convId}/messages`,
        { body }
      );
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations", convId, "messages"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setMessageBody("");
      textareaRef.current?.focus();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    },
  });

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/conversations/${convId}/read`, {
        method: "POST",
      });
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
      
      if (data.type === "new_message" && data.conversationId === convId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/conversations", convId, "messages"],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      } else if (data.type === "typing" && data.conversationId === convId) {
        setIsTyping(data.isTyping);
      }
    };

    return () => {
      ws.current?.close();
    };
  }, [user, convId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark as read when opened
  useEffect(() => {
    if (convId) {
      markAsReadMutation.mutate();
    }
  }, [convId]);

  const handleSendMessage = () => {
    if (!messageBody.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(messageBody);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getInitials = (firstName: string | null, lastName: string | null, email: string) => {
    return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || email[0].toUpperCase();
  };

  const formatMessageDate = (date: Date) => {
    if (isToday(date)) {
      return "Today";
    } else if (isYesterday(date)) {
      return "Yesterday";
    } else {
      return format(date, "EEEE, MMMM d");
    }
  };

  const groupMessagesByDay = (messages: MessageType[]) => {
    const groups: { date: string; messages: MessageType[] }[] = [];
    let currentDate: Date | null = null;

    messages.forEach((msg) => {
      const msgDate = new Date(msg.createdAt);
      
      if (!currentDate || !isSameDay(currentDate, msgDate)) {
        currentDate = msgDate;
        groups.push({
          date: formatMessageDate(msgDate),
          messages: [msg],
        });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });

    return groups;
  };

  const messageGroups = groupMessagesByDay(messages);
  const otherUser = conversation?.otherUser;
  const isOtherUserInactive = otherUser?.status !== "ACTIVE";

  if (!conversation || !otherUser) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">Loading conversation...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center gap-3">
        <Button
          data-testid="button-back-to-directory"
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/messages")}
          className="shrink-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={otherUser.profileImageUrl || undefined} />
          <AvatarFallback>
            {getInitials(otherUser.firstName, otherUser.lastName, otherUser.email)}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-lg leading-tight" data-testid="text-chat-header">
            {otherUser.firstName} {otherUser.lastName}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {otherUser.email}
          </p>
        </div>
      </div>

      {/* Inactive User Banner */}
      {isOtherUserInactive && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2">
          <p className="text-sm text-yellow-700 dark:text-yellow-500">
            This user is inactive and cannot receive messages
          </p>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-6">
          {messageGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {/* Date Separator */}
              <div className="flex items-center justify-center mb-4">
                <div className="bg-muted px-3 py-1 rounded-full">
                  <p className="text-xs text-muted-foreground font-medium">
                    {group.date}
                  </p>
                </div>
              </div>

              {/* Messages for this day */}
              <div className="space-y-2">
                {group.messages.map((msg) => {
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
                          "max-w-[75%] rounded-2xl px-4 py-2",
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                          {msg.body}
                        </p>
                        <p className={cn(
                          "text-xs mt-1",
                          isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}>
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl px-4 py-2">
                <p className="text-sm text-muted-foreground italic">Typing...</p>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            data-testid="input-message-body"
            placeholder={isOtherUserInactive ? "User is inactive" : "Message..."}
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sendMessageMutation.isPending || isOtherUserInactive}
            className="min-h-[44px] max-h-[120px] resize-none"
            rows={1}
          />
          <Button
            data-testid="button-send-message"
            onClick={handleSendMessage}
            disabled={!messageBody.trim() || sendMessageMutation.isPending || isOtherUserInactive}
            size="icon"
            className="shrink-0 h-11 w-11"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
