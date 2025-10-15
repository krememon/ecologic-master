import { useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MessageRedirectProps {
  userId: string;
}

export default function MessageRedirect({ userId }: MessageRedirectProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const createConversationMutation = useMutation({
    mutationFn: async (): Promise<{ id: number }> => {
      const response = await apiRequest("POST", `/api/conversations`, {
        otherUserId: userId,
      });
      return await response.json();
    },
    onSuccess: (data) => {
      setLocation(`/messages/c/${data.id}`, { replace: true });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open conversation",
        variant: "destructive",
      });
      setLocation("/messages", { replace: true });
    },
  });

  useEffect(() => {
    createConversationMutation.mutate();
  }, [userId]);

  return (
    <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
      <p className="text-muted-foreground">Opening conversation...</p>
    </div>
  );
}
