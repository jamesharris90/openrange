const CACHE_VERSION = 'openrange-v1';
const APP_CACHE = `${CACHE_VERSION}-app`;
const API_CACHE = `${CACHE_VERSION}-api`;

const APP_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/OpenRange_Logo_White.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_ASSETS)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => ![APP_CACHE, API_CACHE].includes(key))
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(API_CACHE).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'OpenRange Alert', body: 'Market update available.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {
    const text = event.data ? event.data.text() : '';
    if (text) payload.body = text;
  }

  const alertType = String(payload.type || 'general').toLowerCase();
  const icon = payload.icon || '/android-chrome-192x192.png';
  const tag = payload.tag || `openrange-${alertType}`;

  event.waitUntil(
    self.registration.showNotification(payload.title || 'OpenRange Alert', {
      body: payload.body || 'New alert received.',
      icon,
      badge: payload.badge || '/favicon-32x32.png',
      tag,
      data: {
        url: payload.url || '/alerts',
        symbol: payload.symbol || null,
        type: alertType,
      },
      renotify: true,
      requireInteraction: alertType === 'price' || alertType === 'signal',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/alerts';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
