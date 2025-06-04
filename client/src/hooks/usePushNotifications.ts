import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/queryClient';

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      setIsSupported(true);
      checkSubscription();
    }
  }, []);

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      setSubscription(sub);
      setIsSubscribed(!!sub);
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const requestPermission = async () => {
    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('Error requesting permission:', error);
      return false;
    }
  };

  const subscribeToPush = async () => {
    if (!isSupported) return false;
    
    setIsLoading(true);
    try {
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        console.error('Permission denied for notifications');
        setIsLoading(false);
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      
      // Generate VAPID keys for production - for now using a simple approach
      const vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa40HI-7YirsBAjKFEZJXuEMD7z6VXRB4Q_x-6gPeJGLu8N0G0QUdNE9VmF6BM';
      
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Send subscription to server
      await apiRequest('/api/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          subscription: sub.toJSON()
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      setSubscription(sub);
      setIsSubscribed(true);
      setIsLoading(false);
      return true;
    } catch (error) {
      console.error('Error subscribing to push:', error);
      setIsLoading(false);
      return false;
    }
  };

  const unsubscribeFromPush = async () => {
    if (!subscription) return false;
    
    setIsLoading(true);
    try {
      await subscription.unsubscribe();
      
      // Notify server
      await apiRequest('/api/notifications/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subscription.endpoint
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      setSubscription(null);
      setIsSubscribed(false);
      setIsLoading(false);
      return true;
    } catch (error) {
      console.error('Error unsubscribing from push:', error);
      setIsLoading(false);
      return false;
    }
  };

  const sendTestNotification = async () => {
    try {
      await apiRequest('/api/notifications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      return true;
    } catch (error) {
      console.error('Error sending test notification:', error);
      return false;
    }
  };

  return {
    isSupported,
    isSubscribed,
    isLoading,
    subscribeToPush,
    unsubscribeFromPush,
    sendTestNotification,
  };
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}