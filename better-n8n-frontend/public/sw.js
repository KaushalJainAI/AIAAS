/**
 * Web Push service worker — the closed-browser OS notification channel.
 *
 * The in-page `new Notification()` in useHITLReminders only fires while a tab
 * is open. Push messages from the backend (VAPID, via the browser vendor's
 * push service) wake this worker with every tab closed, and it renders the OS
 * notification here instead.
 *
 * Payload (from notifications/webpush.py): {title, body, action_url, kind}.
 * Kept dependency-free: this file runs outside the Vite bundle.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Notification';
  const body = typeof data.body === 'string' ? data.body : '';
  const actionUrl = typeof data.action_url === 'string' && data.action_url ? data.action_url : '/inbox';
  const tag = typeof data.kind === 'string' && data.kind ? `push-${data.kind}` : 'push-notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || undefined,
      tag,
      // Re-notify rather than stack: one request's nudges collapse onto one row.
      renotify: true,
      requireInteraction: true,
      data: { action_url: actionUrl },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.action_url;
  // Same-origin path only: a stored value that becomes a navigation is the
  // shape lib/nextPath.ts documents as an open-redirect primitive.
  const actionUrl =
    typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/inbox';
  const url = new URL(actionUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
