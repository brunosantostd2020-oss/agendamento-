/* AgendaOK — Service Worker v1.0 */
const CACHE = 'agendaok-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); }
  catch { data = { title: 'AgendaOK', body: e.data.text() }; }

  const opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-72.png',
    tag: data.tag || 'agendaok-notif',
    renotify: true,
    requireInteraction: data.urgente || false,
    vibrate: data.urgente ? [300, 100, 300, 100, 300] : [200, 100, 200],
    data: { url: data.url || '/painel' },
    actions: data.actions || []
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'AgendaOK', opts)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/painel';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      for (const c of cls) {
        if (c.url.includes('/painel') && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
