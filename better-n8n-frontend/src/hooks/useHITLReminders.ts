/**
 * Turns backend nudges into something the user actually sees — and stays
 * quiet when they are already looking.
 *
 * Mounted once in the authenticated Layout. The backend decides *whether* to
 * nudge (escalation ladder, hourly, digest — see notifications/reminders.py);
 * this hook decides how loudly this tab surfaces it:
 *
 * - already on the nudge's target (this tab, or a sibling reporting via the
 *   presence heartbeat) → silent: lists and badges refresh, nothing pops.
 *   Watching the approval queue does not need a popup about the queue.
 * - visible in the app but elsewhere → in-app toast only, no OS ping.
 * - no visible tab anywhere → toast plus the OS notification (and Web Push
 *   covers the fully-closed browser via `public/sw.js`).
 *
 * Two surfaces, not one: an in-app toast always fires when anything fires
 * (sonner is mounted in App), and an OS-level Notification fires on top only
 * at `loud`. The old version fired both unconditionally in every open tab.
 *
 * Scope worth being honest about: the browser Notifications API only fires
 * while a tab is open, backgrounded or not. Delivery to a fully closed
 * browser goes through Web Push (service worker `public/sw.js` + VAPID,
 * subscribed in Settings via useWebPush) — the daily email digest remains a
 * second closed-browser channel.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSocket } from '../lib/websocket';
import { usePublishHitlSocketLive } from './useHitlPending';
import {
  decideSurface,
  isViewingTarget,
  peerOnPlatform,
  peerViewingTarget,
  reportPresence,
  safeTarget,
  type Surface,
} from '../lib/notifyTarget';
import type { HITLReminderPayload } from '../api/notifications';

type SocketMessage = {
  type: string;
  // `reminder` carries HITLReminderPayload; `new_request` carries the HITL
  // row ({request_id, title, message}); `notification` carries the generic
  // Notification row ({title, body|message, action_url}). Read defensively.
  data?: Record<string, unknown> & Partial<HITLReminderPayload>;
};

/** Browser support + current grant, without prompting. */
export function deviceNotificationState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * Prompt for permission. Must be called from a user gesture — browsers ignore
 * (Chrome) or reject (Safari) an ungated request, which is why this is exported
 * for the Settings toggle rather than fired on mount.
 */
export async function requestDeviceNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Repeat frames for one request inside this window refresh rather than re-toast. */
const DEDUPE_WINDOW_MS = 30_000;

export function useHITLReminders(enabled: boolean = true) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  // Collapses repeat nudges for one request onto a single OS notification
  // instead of stacking three toasts over a day.
  const shownRef = useRef<Map<string, Notification>>(new Map());
  const toastedAtRef = useRef<Map<string, number>>(new Map());

  // Tell sibling tabs what this one is showing, so a hidden tab does not
  // raise an OS ping for a page another tab has open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const report = () =>
      reportPresence(location.pathname, location.search, document.visibilityState === 'visible');
    report();
    document.addEventListener('visibilitychange', report);
    return () => document.removeEventListener('visibilitychange', report);
  }, [location.pathname, location.search]);

  const raiseOs = useCallback(
    (title: string, body: string, actionUrl: string, tagKey: string, stage?: number) => {
      if (deviceNotificationState() !== 'granted') return;
      try {
        const notification = new Notification(title, {
          body,
          tag: `${tagKey}-${stage ?? 0}`,
          requireInteraction: true,
        });

        notification.onclick = () => {
          window.focus();
          if (safeTarget(actionUrl)) navigate(actionUrl);
          notification.close();
        };

        shownRef.current.get(tagKey)?.close();
        shownRef.current.set(tagKey, notification);
      } catch {
        // Some browsers throw on constructing Notification outside a service
        // worker (notably Android Chrome). The toast below already fired.
      }
    },
    [navigate],
  );

  const surface = useCallback(
    (title: string, body: string, actionUrl: string, tagKey: string, stage?: number) => {
      if (!title && !body) return;
      const target = safeTarget(actionUrl);
      const selfViewing =
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        isViewingTarget(location.pathname, location.search, target ?? '');
      const level: Surface = decideSurface({
        selfVisible: typeof document !== 'undefined' && document.visibilityState === 'visible',
        selfViewing,
        peerViewing: peerViewingTarget(target ?? ''),
        peerVisible: peerOnPlatform(),
      });
      if (level === 'silent') return;
      // Escalation re-sends per stage and the queue row arrives beside the
      // socket frame: same tag inside the window means "already told", so
      // refresh state without popping a second toast.
      const now = Date.now();
      const lastToast = toastedAtRef.current.get(tagKey) ?? 0;
      if (now - lastToast < DEDUPE_WINDOW_MS) return;
      toastedAtRef.current.set(tagKey, now);
      toast.info(title || 'Notification', {
        description: body || undefined,
        action: target
          ? { label: 'Open', onClick: () => navigate(target) }
          : undefined,
        duration: 8000,
      });
      if (level === 'loud') raiseOs(title, body, target ?? '', tagKey, stage);
    },
    [raiseOs, navigate, location.pathname, location.search],
  );

  const handleMessage = useCallback(
    (message: SocketMessage) => {
      const d = message.data ?? {};
      if (message.type === 'reminder') {
        const title = asText(d.title);
        const body = asText(d.body ?? d.message);
        const actionUrl = asText(d.action_url) || '/runs';
        const tagKey = asText(d.request_id) ? `hitl-${asText(d.request_id)}` : `hitl-${asText(d.kind) || 'reminder'}`;
        surface(title, body, actionUrl, tagKey, typeof d.stage === 'number' ? d.stage : undefined);
        queryClient.invalidateQueries({ queryKey: ['hitl'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } else if (message.type === 'new_request') {
        const title = asText(d.title) || 'Agent needs you';
        const body = asText(d.message ?? d.body);
        // No live sender today (`send_hitl_request_to_user` has no callers),
        // but a frame carrying a request id still deep-links rather than
        // dropping the user on the queue top.
        const requestId = asText(d.request_id);
        surface(title, body, requestId ? `/runs?request=${requestId}` : '/runs', `hitl-${requestId || 'new'}`);
        queryClient.invalidateQueries({ queryKey: ['hitl'] });
      } else if (message.type === 'notification') {
        const title = asText(d.title) || 'Notification';
        const body = asText(d.body ?? d.message);
        // No Open button when the row names nowhere to go: the old fallback
        // sent every such row to settings, which is where "Open" goes to die.
        const actionUrl = asText(d.action_url);
        surface(title, body, actionUrl, `notif-${asText(d.id) || title}`);
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        // A generic notification can also be an HITL-adjacent row (chat
        // approval), so keep the badge honest too.
        queryClient.invalidateQueries({ queryKey: ['hitl'] });
      }
    },
    [surface, queryClient],
  );

  const { isConnected } = useSocket<SocketMessage>({
    path: '/hitl/',
    enabled,
    onMessage: handleMessage,
  });

  // Tells useHitlPending how hard the badge queries have to poll: this socket
  // pushes new requests, so while it is up they only need a slow backstop.
  usePublishHitlSocketLive(isConnected);

  useEffect(() => {
    const shown = shownRef.current;
    return () => {
      shown.forEach((n) => n.close());
      shown.clear();
    };
  }, []);

  return { connected: isConnected };
}

export default useHITLReminders;
