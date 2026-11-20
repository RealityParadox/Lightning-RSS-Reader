/* Service worker: only used for push notifications (no offline cache, no fetch handler). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  /* the app is on screen: no notification */
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (cs.some(c => c.visibilityState == 'visible')) return;
  await self.registration.showNotification(d.title || 'New articles', {
    body: d.body || '', tag: 'unread', renotify: true, icon: 'app-192.png', data: { url: './' },
  });
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow(e.notification.data && e.notification.data.url || './');
  })());
});
