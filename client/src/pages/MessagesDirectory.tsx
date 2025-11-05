import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User } from "lucide-react";
import { useLocation } from "wouter";
import ThreadRow from "@/components/ThreadRow";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PersonInList {
  id: string;
  name: string;
  hasThread: boolean;
  threadId?: string;
  lastMessage?: {
    id: string;
    text: string | null;
    type: "text" | "image" | "file" | "system";
    createdAt: string;
    senderId: string;
  };
  unreadCount: number;
}

export default function MessagesDirectory() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all coworkers with their thread status
  const { data: peopleList = [], isLoading } = useQuery<PersonInList[]>({
    queryKey: ["peopleList"],
    queryFn: async () => {
      const response = await fetch("/api/messages/people-list", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch people list");
      return response.json();
    },
    enabled: !!user,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 5000,
  });

  // Mutation to ensure a thread exists
  const ensureThread = useMutation({
    mutationFn: async (otherUserId: string) => {
      const response = await fetch("/api/messages/threads/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otherUserId }),
      });
      if (!response.ok) throw new Error("Failed to ensure thread");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["peopleList"] });
    },
  });

  const filteredPeople = peopleList.filter((person) =>
    person.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePersonTap = async (person: PersonInList) => {
    if (person.hasThread && person.threadId) {
      // Navigate directly if thread exists
      setLocation(`/messages/c/${person.threadId}`);
    } else {
      // Create thread first, then navigate
      const result: { threadId: string } = await ensureThread.mutateAsync(person.id);
      setLocation(`/messages/c/${result.threadId}`);
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
          {isLoading ? (
            <div className="text-center text-muted-foreground py-16">
              <p className="text-sm">Loading people...</p>
            </div>
          ) : filteredPeople.length === 0 ? (
            <div className="text-center text-muted-foreground py-16">
              <User className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">
                {searchQuery ? "No people found" : "No coworkers yet"}
              </p>
            </div>
          ) : (
            filteredPeople.map((person) => (
              <ThreadRow
                key={person.id}
                name={person.name}
                lastMessageText={
                  person.lastMessage?.text || 
                  (person.hasThread ? null : "Start a conversation")
                }
                lastMessageFromSelf={
                  person.lastMessage?.senderId === user?.id || false
                }
                lastMessageAt={person.lastMessage?.createdAt || null}
                unreadCount={person.unreadCount}
                onClick={() => handlePersonTap(person)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
