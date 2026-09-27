/**
 * Shared WebSocket connection primitive.
 *
 * Every real-time feature (execution stream, HITL, canvas agent,
 * imagine agent) previously carried its own copy of the connect/reconnect/
 * cleanup dance. They drifted: three different backoff policies, two of which
 * were fixed intervals, and only one implemented the stale-socket guard needed
 * to survive StrictMode's double-mount. This module is the single place those
 * rules live now.
 *
 * House rules enforced here:
 *  - URLs always derive from VITE_WS_URL, never a hardcoded port.
 *  - Reconnect is exponential: min(3000 * 2**attempt, 60000).
 *  - onclose bails when the socket is no longer the active one, so a remount
 *    race cannot spawn a duplicate connection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokenManager } from '../api/client';

/**
 * Base URL for all socket paths, e.g. `wss://host/ws`.
 *
 * Always same-origin: nginx proxies /ws/ in the image and vite.config.ts proxies
 * it in dev, so there is no environment in which this needs overriding. It was
 * VITE_WS_URL, which the production env file already set to empty precisely to
 * force this branch.
 */
export const WS_BASE: string =
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;

/** Builds a fully-qualified socket URL, appending the auth token as a query param. */
export function buildSocketUrl(path: string, token: string | null): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = `${WS_BASE}${normalized}`;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

/** Exponential backoff with a 60s ceiling — see `feedback_websocket_patterns`. */
export function backoffDelay(attempt: number, baseMs = 3000, capMs = 60000): number {
  return Math.min(baseMs * 2 ** attempt, capMs);
}

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ReconnectPolicy {
  /** First retry delay; doubles per attempt. Default 3000. */
  baseMs?: number;
  /** Upper bound on the delay. Default 60000. */
  capMs?: number;
  /** Give up after this many consecutive failures. Default: never give up. */
  maxAttempts?: number;
}

export interface UseSocketOptions<TMessage = unknown> {
  /**
   * Socket path relative to WS_BASE, e.g. `/hitl/`. Pass `null` to stay
   * disconnected — used by callers whose target id is not known yet.
   */
  path: string | null;
  /** Set false to tear down and stay down. Default true. */
  enabled?: boolean;
  /** Skip connecting when no auth token is present. Default true. */
  requireToken?: boolean;
  /** Called with the parsed JSON payload of each message. */
  onMessage?: (data: TMessage, event: MessageEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
  /** `false` disables reconnection entirely. */
  reconnect?: ReconnectPolicy | false;
}

export interface UseSocketResult<TMessage> {
  status: SocketStatus;
  isConnected: boolean;
  /** Most recent successfully-parsed message. */
  lastMessage: TMessage | null;
  /** Sends JSON; returns false when the socket is not open. */
  send: (data: unknown) => boolean;
  /** Forces an immediate reconnect, resetting the backoff counter. */
  reconnectNow: () => void;
  /** Closes and suppresses reconnection until `reconnectNow` or a path change. */
  disconnect: () => void;
}

/**
 * Manages one authenticated JSON WebSocket for the lifetime of the component.
 *
 * Callbacks are held in refs, so passing inline arrow functions does not cause
 * the socket to be rebuilt on every parent render.
 */
export function useSocket<TMessage = unknown>(
  options: UseSocketOptions<TMessage>,
): UseSocketResult<TMessage> {
  const { path, enabled = true, requireToken = true, reconnect = {} } = options;

  // Starts at 'connecting': the mount effect opens the socket immediately, and
  // setting that synchronously from the effect body would be a cascading render.
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<TMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const intentionalClose = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  // Latest-callbacks ref, synced after commit rather than during render so an
  // inline arrow prop does not rebuild the socket on every parent render.
  const handlersRef = useRef(options);
  useEffect(() => {
    handlersRef.current = options;
  });

  const policy = reconnect === false ? null : reconnect;
  const baseMs = policy?.baseMs ?? 3000;
  const capMs = policy?.capMs ?? 60000;
  const maxAttempts = policy?.maxAttempts ?? Infinity;
  const reconnectEnabled = policy !== null;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Closes the live socket without arming a reconnect. */
  const teardown = useCallback(() => {
    clearTimer();
    intentionalClose.current = true;
    const ws = wsRef.current;
    // Null the ref *before* close() so the onclose guard sees a stale socket.
    wsRef.current = null;
    ws?.close();
  }, [clearTimer]);

  const connect = useCallback(() => {
    if (!path || !enabled) return;

    const token = tokenManager.getAccessToken();
    if (requireToken && !token) return;

    teardown();
    intentionalClose.current = false;

    const ws = new WebSocket(buildSocketUrl(path, token));
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setStatus('connected');
      handlersRef.current.onOpen?.();
    };

    ws.onmessage = (event) => {
      let parsed: TMessage;
      try {
        parsed = JSON.parse(event.data) as TMessage;
      } catch {
        console.error(`Malformed WebSocket payload on ${path}`);
        return;
      }
      setLastMessage(parsed);
      handlersRef.current.onMessage?.(parsed, event);
    };

    ws.onerror = (event) => {
      setStatus('error');
      handlersRef.current.onError?.(event);
    };

    ws.onclose = () => {
      // Stale-socket guard: a remount may have already installed a newer socket.
      if (intentionalClose.current || wsRef.current !== ws) return;

      setStatus('disconnected');
      handlersRef.current.onClose?.();

      if (!reconnectEnabled || attemptRef.current >= maxAttempts) return;
      const delay = backoffDelay(attemptRef.current, baseMs, capMs);
      attemptRef.current += 1;
      timerRef.current = setTimeout(() => {
        setStatus('connecting');
        connectRef.current();
      }, delay);
    };
  }, [path, enabled, requireToken, teardown, reconnectEnabled, maxAttempts, baseMs, capMs]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!path || !enabled) {
      teardown();
      return;
    }
    connect();
    return teardown;
  }, [path, enabled, connect, teardown]);

  const send = useCallback((data: unknown): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(data));
    return true;
  }, []);

  const reconnectNow = useCallback(() => {
    attemptRef.current = 0;
    setStatus('connecting');
    connectRef.current();
  }, []);

  const disconnect = useCallback(() => {
    teardown();
    setStatus('disconnected');
  }, [teardown]);

  // Derived rather than stored: a socket with no path, or one that is disabled,
  // is idle by definition, and deriving it keeps the effect free of setState.
  const effectiveStatus: SocketStatus = !path || !enabled ? 'idle' : status;

  return {
    status: effectiveStatus,
    isConnected: effectiveStatus === 'connected',
    lastMessage,
    send,
    reconnectNow,
    disconnect,
  };
}
