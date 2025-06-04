import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Plus } from "lucide-react";

export default function Messages() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages"],
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated || messagesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Messages</h1>
          <p className="text-slate-600 dark:text-slate-400">Communicate with clients and subcontractors</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New Message
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          All Messages ({messages.length})
        </h3>
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="h-12 w-12 text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">No messages yet</h3>
            <p className="text-slate-600 dark:text-slate-400 text-center mb-4">
              Start communicating with your team and clients.
            </p>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Send Your First Message
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {messages.map((message: any) => (
            <Card key={message.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  {message.subject || 'Message'}
                </CardTitle>
                <Badge variant={message.isRead ? 'secondary' : 'default'}>
                  {message.isRead ? 'Read' : 'Unread'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {message.sender && (
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    From: {message.sender}
                  </p>
                )}
                {message.content && (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {message.content.substring(0, 150)}...
                  </p>
                )}
                
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-500">
                    {new Date(message.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}