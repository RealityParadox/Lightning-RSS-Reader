/* Service worker: only used for push notifications (no offline cache, no fetch handler). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  /* the app is on screen: it keeps the badge and the list up to date itself, no notification */
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (cs.some(c => c.visibilityState == 'visible')) return;
  /* total unread count on the installed app icon (Badging API, where supported) */
  if (typeof d.unread == 'number' && 'setAppBadge' in self.navigator) {
    try { await (d.unread ? self.navigator.setAppBadge(d.unread) : self.navigator.clearAppBadge()); } catch {}
  }
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
