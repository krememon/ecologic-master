import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  MessageSquare, 
  Plus, 
  Search, 
  Send,
  Mail,
  MailOpen,
  Filter,
  Users
} from "lucide-react";

export default function Messages() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);

  // Redirect to home if not authenticated
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

  const { data: messages, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages"],
    enabled: isAuthenticated,
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/jobs"],
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated || messagesLoading || jobsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const unreadCount = messages?.filter((msg: any) => !msg.isRead).length || 0;

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar user={user} company={user?.company} />
      <main className="flex-1 overflow-auto">
        <Header 
          title="Messages"
          subtitle="Communicate with your team and track project discussions"
          user={user}
        />
        
        <div className="p-6">
          {/* Message Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Messages</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                      {messages?.length || 0}
                    </p>
                  </div>
                  <MessageSquare className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Unread Messages</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                      {unreadCount}
                    </p>
                  </div>
                  <Mail className="w-8 h-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Active Threads</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                      {jobs?.length || 0}
                    </p>
                  </div>
                  <Users className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input 
                placeholder="Search messages..." 
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select>
                <SelectTrigger className="w-40">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter messages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Messages</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="job">Job Related</SelectItem>
                </SelectContent>
              </Select>
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    New Message
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Send New Message</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Subject
                      </label>
                      <Input placeholder="Message subject" className="mt-1" />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Related Job (Optional)
                      </label>
                      <Select>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select a job" />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs?.map((job: any) => (
                            <SelectItem key={job.id} value={job.id.toString()}>
                              {job.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Message
                      </label>
                      <Textarea 
                        placeholder="Write your message..." 
                        className="mt-1 min-h-[120px]"
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button>
                        <Send className="w-4 h-4 mr-2" />
                        Send Message
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Messages List */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Messages</CardTitle>
            </CardHeader>
            <CardContent>
              {!messages || messages.length === 0 ? (
                <div className="py-16 text-center">
                  <MessageSquare className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    No messages found
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 mb-6">
                    Start a conversation with your team to coordinate projects.
                  </p>
                  <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Send Your First Message
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message: any) => (
                    <div 
                      key={message.id}
                      className={`flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer ${
                        !message.isRead ? 'bg-blue-50 dark:bg-blue-950/30' : ''
                      }`}
                      onClick={() => setSelectedMessage(message)}
                    >
                      <div className="flex items-center space-x-4">
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={message.sender?.profileImageUrl} />
                          <AvatarFallback>
                            {message.sender?.firstName?.[0]}{message.sender?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <p className={`font-medium ${!message.isRead ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
                              {message.sender?.firstName} {message.sender?.lastName}
                            </p>
                            {message.job && (
                              <Badge variant="outline" className="text-xs">
                                {message.job.title}
                              </Badge>
                            )}
                          </div>
                          <p className={`text-sm ${!message.isRead ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-400'}`}>
                            {message.subject}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-500 line-clamp-1">
                            {message.content}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {!message.isRead ? (
                          <MailOpen className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Mail className="w-5 h-5 text-slate-400" />
                        )}
                        <span className="text-sm text-slate-500 dark:text-slate-500">
                          {new Date(message.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Message Detail Modal */}
          {selectedMessage && (
            <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{selectedMessage.subject}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <Avatar>
                      <AvatarImage src={selectedMessage.sender?.profileImageUrl} />
                      <AvatarFallback>
                        {selectedMessage.sender?.firstName?.[0]}{selectedMessage.sender?.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {selectedMessage.sender?.firstName} {selectedMessage.sender?.lastName}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {new Date(selectedMessage.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {selectedMessage.job && (
                      <Badge variant="outline">
                        Job: {selectedMessage.job.title}
                      </Badge>
                    )}
                  </div>
                  
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {selectedMessage.content}
                    </p>
                  </div>
                  
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <Textarea placeholder="Reply to this message..." className="mb-3" />
                    <div className="flex justify-end space-x-2">
                      <Button variant="outline" onClick={() => setSelectedMessage(null)}>
                        Close
                      </Button>
                      <Button>
                        <Send className="w-4 h-4 mr-2" />
                        Reply
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </main>
    </div>
  );
}
