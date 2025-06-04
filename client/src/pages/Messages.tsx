import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageSquare, Send, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertMessageSchema, type InsertMessage, type Message } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function CreateMessageForm({ onSubmit, isLoading }: { onSubmit: (data: InsertMessage) => void; isLoading: boolean }) {
  const form = useForm<InsertMessage>({
    resolver: zodResolver(insertMessageSchema),
    defaultValues: {
      subject: "",
      content: "",
      recipientId: "",
      isRead: false,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="recipientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recipient ID</FormLabel>
              <FormControl>
                <Input 
                  placeholder="recipient-user-id" 
                  value={field.value || ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Project Update" 
                  value={field.value || ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea placeholder="Enter your message here..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Sending..." : "Send Message"}
        </Button>
      </form>
    </Form>
  );
}

export default function Messages() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  const { data: messages = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
    enabled: isAuthenticated,
  });

  const createMessageMutation = useMutation({
    mutationFn: async (messageData: InsertMessage) => {
      const res = await apiRequest("POST", "/api/messages", messageData);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      toast({
        title: "Success",
        description: "Message sent successfully",
      });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
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
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Messages</h1>
        <p className="text-slate-600 dark:text-slate-400">Communicate with clients and subcontractors</p>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[350px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Send New Message</DialogTitle>
          </DialogHeader>
          <CreateMessageForm onSubmit={createMessageMutation.mutate} isLoading={createMessageMutation.isPending} />
        </DialogContent>
      </Dialog>

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
            <Button onClick={() => setIsDialogOpen(true)}>
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