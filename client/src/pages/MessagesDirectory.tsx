import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User } from "lucide-react";
import { useLocation } from "wouter";
import ThreadRow from "@/components/ThreadRow";

interface MessageThread {
  id: string;
  otherUser: {
    id: string;
    name: string;
  };
  lastMessage: {
    id: string;
    text: string | null;
    type: "text" | "image" | "file" | "system";
    createdAt: string;
    senderId: string;
  } | null;
  unreadCount: number;
  lastReadAt: string | null;
}

export default function MessagesDirectory() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch message threads (iOS-style)
  const { data: threads = [], isLoading } = useQuery<MessageThread[]>({
    queryKey: ["/api/messages/threads"],
    enabled: !!user,
    refetchInterval: 5000,
  });

  const filteredThreads = threads.filter((thread) =>
    thread.otherUser.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const handleThreadTap = (thread: MessageThread) => {
    // Navigate to conversation
    setLocation(`/messages/c/${thread.id}`);
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

      {/* Conversation Threads List */}
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {isLoading ? (
            <div className="text-center text-muted-foreground py-16">
              <p className="text-sm">Loading conversations...</p>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="text-center text-muted-foreground py-16">
              <User className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">
                {searchQuery ? "No conversations found" : "No conversations yet"}
              </p>
            </div>
          ) : (
            filteredThreads
              .filter((thread) => thread.lastMessage !== null) // Only show threads with messages
              .map((thread) => (
                <ThreadRow
                  key={thread.id}
                  name={thread.otherUser.name}
                  lastMessageText={thread.lastMessage!.text || null}
                  lastMessageFromSelf={thread.lastMessage!.senderId === user?.id}
                  lastMessageAt={thread.lastMessage!.createdAt}
                  unreadCount={thread.unreadCount}
                  onClick={() => handleThreadTap(thread)}
                />
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
