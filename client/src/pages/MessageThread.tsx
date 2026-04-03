import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronLeft, Send, Loader2, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { isRenderableMessage, groupByDay, formatDayLabel, formatTime, mergeMessages, MessageType as MsgType } from "@/lib/messageUtils";
import { motion, useSpring, useTransform, MotionValue } from "framer-motion";

interface MessageType {
  id: number | string; // Allow string for optimistic IDs
  tempId?: string; // For reconciliation
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
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const [messages, setMessages] = useState<MessageType[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ws = useRef<WebSocket | null>(null);
  const genRef = useRef(0);
  const didMountRef = useRef(false);
  const isSelfTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swipe-to-reveal timestamps state
  const progress = useSpring(0, { stiffness: 260, damping: 30 });
  const rawProgressRef = useRef(0);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  // Detect if this is a userId or conversationId based on the URL path
  const isUserId = location.startsWith('/messages/u/');
  const numericConvId = !isUserId ? parseInt(conversationId) : null;

  // State for DM data
  const [dmData, setDmData] = useState<DMOpenResponse | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  const [dmLoading, setDmLoading] = useState(isUserId);

  // Debug: Log component mount/unmount and key state
  useEffect(() => {
    console.log('[MessageThread] MOUNTED with:', { 
      conversationId, 
      isUserId, 
      numericConvId,
      queryEnabled: !!numericConvId && !isNaN(numericConvId!)
    });
    return () => console.log('[MessageThread] UNMOUNTED');
  }, []);

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

  // Fallback to numeric conversation ID flow - fetch single conversation with otherUser
  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: [`/api/conversations/${numericConvId}`],
    enabled: !!numericConvId && !isNaN(numericConvId!),
  });

  const { data: fetchedMessages = [], isLoading: messagesLoading } = useQuery<MessageType[]>({
    queryKey: [`/api/conversations/${numericConvId}/messages`],
    enabled: !!numericConvId && !isNaN(numericConvId!),
    staleTime: 0, // Always fetch fresh data for store-and-forward delivery
    refetchOnMount: "always", // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnReconnect: true, // Refetch when network reconnects
    refetchInterval: 5000, // Poll every 5 seconds for new messages
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
  
  // Merge fetched messages with local state (never replace)
  useEffect(() => {
    if (dmData?.messages) {
      const normalized = dmData.messages.map(m => ({ 
        ...m, 
        createdAt: new Date(m.createdAt) 
      }));
      setMessages(prev => mergeMessages(prev, normalized));
    }
  }, [dmData]);
  
  // Hydrate messages from API on mount and whenever fetchedMessages changes
  // IMPORTANT: No length guard - we must always update state when data arrives
  // This fixes the bug where messages disappear on navigation back
  useEffect(() => {
    console.log('[MessageThread] fetchedMessages updated:', { 
      count: fetchedMessages.length, 
      conversationId: numericConvId,
      first: fetchedMessages[0]?.body?.slice(0, 30),
      last: fetchedMessages[fetchedMessages.length - 1]?.body?.slice(0, 30)
    });
    
    // Always set messages from server data - merge to preserve optimistic messages
    setMessages(prev => {
      if (fetchedMessages.length === 0 && prev.length === 0) return prev;
      return mergeMessages(prev, fetchedMessages);
    });
  }, [fetchedMessages, numericConvId]);

  // Debug: Log conversation data
  useEffect(() => {
    console.log('[MessageThread] conversation data:', conversation);
    console.log('[MessageThread] dmData:', dmData);
  }, [conversation, dmData]);

  // Get other user info - primary source is DM data or conversation query
  const otherUserFromData = dmData?.otherUser || (conversation as any)?.otherUser;
  
  // Debug: Log derived other user
  console.log('[MessageThread] otherUserFromData:', otherUserFromData);
  
  // Fallback: Derive other user from messages if primary sources fail
  const [derivedOtherUser, setDerivedOtherUser] = useState<OtherUserType | null>(null);
  
  // Derive other participant from loaded messages when primary sources are empty
  useEffect(() => {
    if (otherUserFromData || !user || messages.length === 0) return;
    
    // Find a message not sent by current user to get the other participant's ID
    const otherMessage = messages.find(m => m.senderId !== user.id);
    const otherUserId = otherMessage?.senderId;
    
    if (!otherUserId || derivedOtherUser?.id === otherUserId) return;
    
    // Fetch the other user's profile
    const fetchOtherUser = async () => {
      try {
        const response = await fetch(`/api/users/${otherUserId}`);
        if (response.ok) {
          const userData = await response.json();
          setDerivedOtherUser({
            id: userData.id,
            name: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || 'Unknown',
            avatar: userData.profileImageUrl || userData.avatar || null,
            role: userData.role || 'member',
            status: userData.status || 'active',
          });
        }
      } catch (error) {
        console.error('[MessageThread] Failed to fetch other user:', error);
      }
    };
    
    fetchOtherUser();
  }, [user, messages, otherUserFromData, derivedOtherUser?.id]);
  
  // Use derived user as fallback when primary sources are empty
  const otherUser = otherUserFromData || derivedOtherUser;

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

  // Send message via WebSocket with HTTP fallback (mobile / Bearer-token users cannot open WS)
  const sendMessage = (body: string) => {
    if (!body.trim() || !currentConvId) return;

    const trimmed = body.trim();
    const tempId = crypto.randomUUID();
    const optimisticMessage: MessageType = {
      id: tempId,
      tempId,
      senderId: user!.id,
      body: trimmed,
      createdAt: new Date(),
      isPending: true,
    };

    // Add optimistic message immediately and clear composer — same for both paths
    setMessages(prev => mergeMessages(prev, [optimisticMessage]));
    setMessageBody("");

    const wsOpen = ws.current && ws.current.readyState === WebSocket.OPEN;

    if (wsOpen) {
      // ── WS path (web / session-cookie users) ──────────────────────────────
      console.log(`[SEND] WS →`, { conversationId: currentConvId, tempId, len: trimmed.length });

      const t0 = Date.now();
      const timeoutId = setTimeout(() => {
        console.warn(`[SEND] WS timeout after ${Date.now() - t0}ms for tempId ${tempId}`);
        setMessages(prev =>
          mergeMessages(prev, [{ ...optimisticMessage, isPending: false, isFailed: true }])
        );
        toast({
          title: "Message failed",
          description: "Message took too long to send. Please try again.",
          variant: "destructive",
        });
      }, 7000);

      ws.current!.send(
        JSON.stringify({
          type: 'message:send',
          conversationId: currentConvId,
          recipientId: otherUser?.id,
          body: trimmed,
          tempId,
          requestId: `send-${Date.now()}`
        })
      );

      (ws.current as any)[`timeout_${tempId}`] = timeoutId;
    } else {
      // ── HTTP fallback (mobile / Bearer-token — WS upgrade is rejected) ────
      console.log(`[SEND] HTTP fallback → conversationId=${currentConvId}, tempId=${tempId}, len=${trimmed.length}`);

      apiRequest("POST", `/api/conversations/${currentConvId}/messages`, { body: trimmed })
        .then(res => res.json())
        .then((message: any) => {
          console.log(`[SEND] HTTP ✓ id=${message.id}`);
          setMessages(prev => mergeMessages(prev, [{
            ...message,
            createdAt: new Date(message.createdAt),
            tempId,
            isPending: false,
          }]));
          queryClient.invalidateQueries({ queryKey: ["peopleList"] });
        })
        .catch((err: any) => {
          console.error(`[SEND] HTTP ✗`, err);
          setMessages(prev =>
            mergeMessages(prev, [{ ...optimisticMessage, isPending: false, isFailed: true }])
          );
          toast({
            title: "Message failed",
            description: "Could not send message. Please try again.",
            variant: "destructive",
          });
        });
    }
  };

  // Dummy mutation for compatibility (not used anymore)
  const sendMessageMutation = {
    mutate: (body: string) => sendMessage(body),
    isPending: false,
  };

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!currentConvId) return;
      await apiRequest("POST", `/api/conversations/${currentConvId}/read`);
    },
  });

  // WebSocket connection with room-based subscriptions
  useEffect(() => {
    if (!user || !currentConvId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log(`[WS:OPEN] Connected to WebSocket`);
      
      // Authenticate
      ws.current?.send(JSON.stringify({ type: "auth", userId: user.id }));
      console.log(`[WS:AUTH] Sent auth for userId: ${user.id}`);
      
      // Join conversation room
      setTimeout(() => {
        console.log(`[WS:JOIN] Joining conversation room ${currentConvId}`);
        ws.current?.send(JSON.stringify({ 
          type: "thread:join", 
          conversationId: currentConvId,
          requestId: `join-${Date.now()}`
        }));
      }, 100);
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle join ACK
      if (data.type === "thread:join:ack") {
        if (data.ok) {
          console.log(`[WS:JOIN:ACK] ✓ Joined room ${data.room}`, data);
        } else {
          console.error(`[WS:JOIN:ACK] ✗ Failed to join room:`, data.code);
        }
      }
      
      // Handle leave ACK
      else if (data.type === "thread:leave:ack") {
        if (data.ok) {
          console.log(`[WS:LEAVE:ACK] ✓ Left conversation ${data.conversationId}`);
        } else {
          console.error(`[WS:LEAVE:ACK] ✗ Failed to leave:`, data.code);
        }
      }
      
      // Handle message acknowledgment
      else if (data.type === "message:ack") {
        const { ok, tempId, message, code, dt } = data;
        console.log(`[WS:SEND:ACK] ${ok ? '✓' : '✗'} tempId: ${tempId}, dt: ${dt}ms`, { ok, code });
        
        // Clear timeout
        if (ws.current && (ws.current as any)[`timeout_${tempId}`]) {
          clearTimeout((ws.current as any)[`timeout_${tempId}`]);
          delete (ws.current as any)[`timeout_${tempId}`];
        }
        
        if (ok && message) {
          // Merge real message (replaces optimistic via tempId)
          setMessages(prev => mergeMessages(prev, [{
            ...message,
            createdAt: new Date(message.createdAt),
          }]));
          
          // Invalidate peopleList to update inbox preview and timestamp
          queryClient.invalidateQueries({ queryKey: ["peopleList"] });
          
          if (composerFocusedRef.current) {
            textareaRef.current?.focus();
          }
        } else {
          // Mark as failed using merge
          setMessages(prev => {
            const failedMsg = prev.find(m => String(m.id) === String(tempId) || m.tempId === tempId);
            if (!failedMsg) return prev;
            return mergeMessages(prev, [{
              ...failedMsg,
              isPending: false,
              isFailed: true,
            }]);
          });
          
          // Show error toast
          if (code === 'RECIPIENT_INACTIVE') {
            toast({
              title: "Cannot send message",
              description: "Recipient is inactive",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Failed to send",
              description: "Message failed to send. Please try again.",
              variant: "destructive",
            });
          }
        }
      }
      
      // Handle new message broadcast
      else if (data.type === "message:created" && data.conversationId === currentConvId) {
        const incomingMsg = data.message;
        console.log(`[WS:BROADCAST] Received message:created for conversation ${currentConvId}`, incomingMsg);
        
        // Merge incoming message (reconciles via tempId if present)
        setMessages(prev => mergeMessages(prev, [{
          ...incomingMsg,
          createdAt: new Date(incomingMsg.createdAt),
        }]));
      }
      
      // Handle peer typing:start
      else if (data.type === "typing:start" && data.conversationId === currentConvId) {
        setPeerIsTyping(true);
        if (peerTypingGuardRef.current) clearTimeout(peerTypingGuardRef.current);
        peerTypingGuardRef.current = setTimeout(() => setPeerIsTyping(false), 5000);
        console.log(`[WS:TYPING] recv start convId=${currentConvId}`);
      }
      // Handle peer typing:stop
      else if (data.type === "typing:stop" && data.conversationId === currentConvId) {
        setPeerIsTyping(false);
        if (peerTypingGuardRef.current) { clearTimeout(peerTypingGuardRef.current); peerTypingGuardRef.current = null; }
        console.log(`[WS:TYPING] recv stop convId=${currentConvId}`);
      }
    };

    return () => {
      // Emit typing:stop if we were typing when leaving
      if (isSelfTypingRef.current && ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'typing:stop', conversationId: currentConvId }));
        isSelfTypingRef.current = false;
      }
      if (typingStopTimerRef.current) { clearTimeout(typingStopTimerRef.current); typingStopTimerRef.current = null; }
      if (peerTypingGuardRef.current) { clearTimeout(peerTypingGuardRef.current); peerTypingGuardRef.current = null; }
      setPeerIsTyping(false);

      // Leave conversation room before closing
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        console.log(`[WS:LEAVE] Leaving conversation room ${currentConvId}`);
        ws.current.send(JSON.stringify({ 
          type: "thread:leave", 
          conversationId: currentConvId,
          requestId: `leave-${Date.now()}`
        }));
      }
      
      console.log(`[WS:CLOSE] Closing WebSocket connection`);
      ws.current?.close();
    };
  }, [user, currentConvId]);

  const scrollToBottom = (smooth: boolean) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  };

  useEffect(() => {
    // On first mount: jump instantly (no animation)
    if (!didMountRef.current) {
      scrollToBottom(false);
      didMountRef.current = true;
      return;
    }
    // On subsequent message changes: smooth scroll
    scrollToBottom(true);
  }, [messages.length]); // Only trigger on count change, not array reference

  // Mark as read when opened
  useEffect(() => {
    if (currentConvId) {
      markAsReadMutation.mutate();
    }
  }, [currentConvId]);

  const composerFocusedRef = useRef(false);

  const emitTypingStart = () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !currentConvId) return;
    if (isSelfTypingRef.current) return;
    isSelfTypingRef.current = true;
    ws.current.send(JSON.stringify({ type: 'typing:start', conversationId: currentConvId }));
    console.log(`[WS:TYPING] emit start convId=${currentConvId}`);
  };

  const emitTypingStop = () => {
    if (typingStopTimerRef.current) { clearTimeout(typingStopTimerRef.current); typingStopTimerRef.current = null; }
    if (!isSelfTypingRef.current) return;
    isSelfTypingRef.current = false;
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !currentConvId) return;
    ws.current.send(JSON.stringify({ type: 'typing:stop', conversationId: currentConvId }));
    console.log(`[WS:TYPING] emit stop convId=${currentConvId}`);
  };

  const handleSend = () => {
    if (!messageBody.trim() || !currentConvId) return;
    emitTypingStop();
    sendMessage(messageBody.trim());
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

  // Swipe-to-reveal timestamp handlers
  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // Start horizontal gesture only if mostly horizontal and moved enough
    if (!draggingRef.current) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) return; // Vertical scroll wins
      draggingRef.current = true;
      e.preventDefault();
    }

    if (draggingRef.current) {
      e.preventDefault();
      // Only consider left drag (negative dx)
      const left = Math.min(0, dx);
      const p = Math.min(1, Math.max(0, -left / 80)); // 0..1 over ~80px
      rawProgressRef.current = p;
      progress.set(p);
    }
  };

  const onPointerUpOrLeave = () => {
    startRef.current = null;
    draggingRef.current = false;
    // Snap back
    progress.stop();
    progress.set(0);
    rawProgressRef.current = 0;
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

  // Lock page scroll on mount — html + body must both be locked for iOS WebView
  useEffect(() => {
    document.documentElement.classList.add('chat-screen-active');
    document.body.classList.add('chat-screen-active');
    return () => {
      document.documentElement.classList.remove('chat-screen-active');
      document.body.classList.remove('chat-screen-active');
    };
  }, []);

  // Show header and composer immediately, even while loading
  return (
    <div className="flex flex-col bg-background overflow-hidden h-full">
      {/* Header - fixed height, with iOS safe area top padding */}
      <div className="flex-shrink-0 flex items-center gap-3 p-4 border-b border-border bg-card dmThreadHeader">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/messages")}
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
        ) : (dmLoading || messagesLoading) ? (
          <div className="flex-1">
            <div className="h-5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-3 w-20 bg-muted animate-pulse rounded mt-1" />
          </div>
        ) : (
          <div className="flex-1">
            <h2 className="font-semibold" data-testid="text-other-user-name">
              {messages.length === 0 ? "New Message" : "Conversation"}
            </h2>
          </div>
        )}
      </div>

      {/* Messages Area - flex-1 to fill available space, only this scrolls */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-3 pt-4 touch-pan-y" 
        data-testid="scroll-area-messages"
        style={{
          scrollBehavior: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUpOrLeave}
        onPointerCancel={onPointerUpOrLeave}
        onPointerLeave={onPointerUpOrLeave}
      >
        {dmLoading || messagesLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && !peerIsTyping ? (
          /* Only show empty state when no messages AND nobody is typing */
          <div className="flex items-center justify-center h-full text-center text-muted-foreground">
            <div>
              <p className="text-sm" data-testid="text-no-messages">
                Start a conversation with {otherUser?.name || 'this user'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.length > 0 && (() => {
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
                        <MessageBubble
                          key={msg.id}
                          msg={msg}
                          isCurrentUser={isCurrentUser}
                          progress={progress}
                          userId={user?.id}
                        />
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
            {/* Typing indicator — inside the messages branch so it always renders when active */}
            {peerIsTyping && (
              <div className="flex gap-2 max-w-[80%] mr-auto" data-testid="typing-indicator">
                <div className="bg-muted rounded-2xl px-4 py-3 flex items-center gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/60 rounded-full inline-block" style={{ animation: 'typingDot 1.2s ease-in-out infinite', animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground/60 rounded-full inline-block" style={{ animation: 'typingDot 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                  <span className="w-2 h-2 bg-muted-foreground/60 rounded-full inline-block" style={{ animation: 'typingDot 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer - pinned at bottom; safe-area padding extends bg to screen edge on iOS */}
      <div
        className="flex-shrink-0 px-3 pt-2 border-t border-border bg-card"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
      >
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            data-testid="textarea-message-input"
            placeholder="Type a message..."
            value={messageBody}
            onChange={(e) => {
              const val = e.target.value;
              setMessageBody(val);
              if (val.trim()) {
                emitTypingStart();
                if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
                typingStopTimerRef.current = setTimeout(emitTypingStop, 2000);
              } else {
                emitTypingStop();
              }
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { composerFocusedRef.current = true; }}
            onBlur={() => { composerFocusedRef.current = false; }}
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

// Message bubble component with swipe-to-reveal timestamp
interface MessageBubbleProps {
  msg: MessageType;
  isCurrentUser: boolean;
  progress: MotionValue<number>;
  userId?: string;
}

function MessageBubble({ msg, isCurrentUser, progress, userId }: MessageBubbleProps) {
  const timeStr = msg.isPending ? "Sending..." : msg.isFailed ? "Failed" : formatTime(msg.createdAt);
  const x = useTransform(progress, (p) => -Math.round(p * 56));

  return (
    <div
      className={cn(
        "relative flex max-w-[75%]",
        isCurrentUser ? "ml-auto justify-end" : "mr-auto justify-start"
      )}
      data-testid={`message-${msg.id}`}
    >
      {/* Timestamp (revealed on drag) - always on right side */}
      <motion.div
        style={{
          opacity: progress,
        }}
        className="absolute right-0 top-1/2 -translate-y-1/2 select-none text-[10px] text-muted-foreground pointer-events-none whitespace-nowrap pr-2"
      >
        {timeStr}
      </motion.div>

      {/* Bubble shifts left as progress increases */}
      <motion.div
        style={{ x }}
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
      </motion.div>
    </div>
  );
}
