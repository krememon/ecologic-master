// Service Worker for Push Notifications
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/',
        id: data.id
      },
      actions: [
        {
          action: 'view',
          title: 'View',
          icon: '/vite.svg'
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
          icon: '/vite.svg'
        }
      ],
      requireInteraction: true,
      tag: data.tag || 'ecologic-alert'
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  } else if (event.action === 'dismiss') {
    return;
  } else {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  }
});

self.addEventListener('notificationclose', function(event) {
  console.log('Notification closed:', event.notification.tag);
});
