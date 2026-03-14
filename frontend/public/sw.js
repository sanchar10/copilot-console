// Service Worker for Copilot Console PWA
// Handles push notifications and caching for mobile companion

const CACHE_NAME = 'copilot-console-v2';
const APP_SHELL = ['/index.html', '/mobile', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for API calls and SSE streams
  if (url.pathname.startsWith('/api')) {
    return;
  }

  // Navigation requests — network-first with cached /index.html fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match('/index.html').then(
          (cached) => cached || new Response('', { status: 503 })
        )
      )
    );
    return;
  }

  // Static assets — network-first with cache fallback for offline
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then(
          (cached) => cached || new Response('', { status: 503 })
        )
      )
    );
    return;
  }
});

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Copilot Console', body: event.data.text() };
  }

  const title = payload.title || '🤖 Copilot Console';
  const options = {
    body: payload.body || 'An agent has finished responding',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
    tag: payload.data?.session_id || 'copilot-console',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click — open/focus the mobile app at the session
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/mobile';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if found
      for (const client of windowClients) {
        if (client.url.includes('/mobile') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(url);
    })
  );
});
