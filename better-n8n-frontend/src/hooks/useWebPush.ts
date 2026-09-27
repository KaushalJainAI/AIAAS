/**
 * Closed-browser push (Web Push) subscription management.
 *
 * The in-page `new Notification()` in useHITLReminders only fires while a tab
 * is open. This hook owns the other half: registering `public/sw.js`,
 * subscribing the browser with the server's VAPID key, and storing that
 * subscription so the backend can wake the service worker with every tab
 * closed. Mounted in Layout for SW registration; the Settings toggle calls
 * enable()/disable() — subscribing must happen in a user gesture or the
 * permission prompt is ignored.
 */

import { useCallback, useEffect, useState } from 'react';
import { notificationsService } from '../api/notifications';

function isSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(base64.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export function useWebPush(enabled: boolean = true) {
  const [supported] = useState<boolean>(isSupported);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [serverEnabled, setServerEnabled] = useState<boolean>(false);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  // Register the worker + reconcile state while signed in. If the browser
  // holds a subscription the server never saw (cleared DB, second deploy),
  // re-post it so pushes resume without asking again.
  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;
    (async () => {
      const reg = await getRegistration();
      if (!reg || cancelled) return;
      try {
        const { public_key, enabled: live } = await notificationsService.getVapidKey();
        if (cancelled) return;
        setServerEnabled(live);
        if (!live || !public_key) return;
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (existing) {
          setSubscribed(true);
          try {
            const raw = existing.toJSON();
            await notificationsService.subscribePush({
              endpoint: existing.endpoint,
              p256dh: String(raw.keys?.p256dh ?? ''),
              auth: String(raw.keys?.auth ?? ''),
              user_agent: navigator.userAgent.slice(0, 255),
            });
          } catch {
            // Reconcile is best-effort; the enable path reports errors.
          }
        }
      } catch {
        // Signed-out or offline: the toggle reports when it is used.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supported]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    setBusy(true);
    try {
      if (Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // Falls through to the permission read below.
        }
        setPermission(Notification.permission);
      }
      if (Notification.permission !== 'granted') return false;
      const { public_key, enabled: live } = await notificationsService.getVapidKey();
      setServerEnabled(live);
      if (!live || !public_key) return false;
      const reg = await getRegistration();
      if (!reg) return false;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
      const raw = sub.toJSON();
      await notificationsService.subscribePush({
        endpoint: sub.endpoint,
        p256dh: String(raw.keys?.p256dh ?? ''),
        auth: String(raw.keys?.auth ?? ''),
        user_agent: navigator.userAgent.slice(0, 255),
      });
      setSubscribed(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported]);

  const disable = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        try {
          await notificationsService.unsubscribePush(sub.endpoint);
        } catch {
          // Remove locally regardless; a stale row is pruned on next 410.
        }
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, permission, serverEnabled, subscribed, busy, enable, disable };
}

export default useWebPush;
