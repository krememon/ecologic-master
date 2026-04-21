import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "./useAuth";
import { useToast } from "./use-toast";

interface WebSocketMessage {
  type: string;
  data?: any;
  userId?: string;
}

export function useWebSocket() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const authFailCountRef = useRef(0);

  const connect = useCallback(() => {
    if (!isAuthenticated || !user?.id) return;
    if (authFailCountRef.current >= 3) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] connected');
        setIsConnected(true);
        authFailCountRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'auth_success') {
            console.log('[WS] authenticated via session, userId=', message.userId);
          } else if (message.type === 'session_revoked') {
            console.log('[WS] session revoked');
            disconnect();
            window.location.href = '/?error=' + (message.data?.code || 'session_revoked') + '&message=' + encodeURIComponent(message.data?.message || 'Your session has ended. Please sign in again.');
          } else if (message.type === 'invite_code_rotated') {
            const evt = new CustomEvent('invite_code_rotated', { 
              detail: message.data 
            });
            window.dispatchEvent(evt);
          } else if (message.type === 'new_message') {
            toast({
              title: "New Message",
              description: `${message.data.senderName}: ${message.data.content.substring(0, 50)}${message.data.content.length > 50 ? '...' : ''}`,
              duration: 5000,
            });
            
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('New Message', {
                body: `${message.data.senderName}: ${message.data.content}`,
                icon: '/manifest-icon-192.png',
                tag: 'message'
              });
            }
          }
        } catch (error) {
          console.error('[WS] parse error:', error);
        }
      };

      ws.onclose = (ev) => {
        console.log(`[WS] closed code=${ev.code}`);
        setIsConnected(false);
        wsRef.current = null;
        
        if (ev.code === 4401 || ev.code === 1008) {
          authFailCountRef.current++;
          console.log(`[WS] auth failure #${authFailCountRef.current}`);
          if (authFailCountRef.current >= 3) {
            console.log('[WS] too many auth failures — session may be expired');
            return;
          }
        }

        if (isAuthenticated) {
          const delay = Math.min(3000 * Math.pow(1.5, authFailCountRef.current), 15000);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('[WS] connection error:', error);
    }
  }, [isAuthenticated, user?.id]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (connectDebounceRef.current) {
      clearTimeout(connectDebounceRef.current);
      connectDebounceRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated && user?.id) {
      authFailCountRef.current = 0;
      if (connectDebounceRef.current) clearTimeout(connectDebounceRef.current);
      connectDebounceRef.current = setTimeout(() => {
        connect();
      }, 300);
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, user?.id, isLoading]);

  return {
    isConnected,
    connect,
    disconnect
  };
}
