import { useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useToast } from "./use-toast";

interface WebSocketMessage {
  type: string;
  data?: any;
}

export function useWebSocket() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = () => {
    if (!isAuthenticated || !user?.id) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        
        // Authenticate with the server
        ws.send(JSON.stringify({
          type: 'auth',
          userId: user.id
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'auth_success') {
            console.log('WebSocket authenticated successfully');
          } else if (message.type === 'session_revoked') {
            // User was deactivated - force sign out and redirect
            console.log('Session revoked - redirecting to login');
            disconnect();
            window.location.href = '/?error=' + (message.data?.code || 'session_revoked') + '&message=' + encodeURIComponent(message.data?.message || 'Your session has ended. Please sign in again.');
          } else if (message.type === 'invite_code_rotated') {
            // Dispatch custom event for invite code rotation
            const event = new CustomEvent('invite_code_rotated', { 
              detail: message.data 
            });
            window.dispatchEvent(event);
          } else if (message.type === 'new_message') {
            // Show notification for new message
            toast({
              title: "New Message",
              description: `${message.data.senderName}: ${message.data.content.substring(0, 50)}${message.data.content.length > 50 ? '...' : ''}`,
              duration: 5000,
            });
            
            // Trigger browser notification if permission granted
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('New Message', {
                body: `${message.data.senderName}: ${message.data.content}`,
                icon: '/manifest-icon-192.png',
                tag: 'message'
              });
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;
        
        // Attempt to reconnect after 3 seconds
        if (isAuthenticated) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  };

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, user?.id]);

  return {
    isConnected,
    connect,
    disconnect
  };
}