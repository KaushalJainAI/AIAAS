# WebSocket Overuse & Polling Anti-Patterns

> Source: `better-n8n-frontend/src/hooks/useBuddy.ts`, `src/pages/Orchestrator.tsx`
> Fixed: April 2026

---

## The Problem: Too Many Backend Calls

The Buddy and chat pages were hammering the backend with unnecessary requests. Understanding *why* and *how to fix* each pattern is a common system design / frontend architecture question.

---

## Anti-Pattern 1: MutationObserver for Context Sync

**What was happening:**
```typescript
//  BAD — fires on every React re-render that touches the DOM
const observer = new MutationObserver(() => {
  clearTimeout(timeout);
  timeout = setTimeout(() => sendContextUpdate(), 1000); // 1s debounce
});
observer.observe(document.body, { childList: true, subtree: true });
```

With `subtree: true` on `document.body`, this fires for every DOM change in the entire app — typing a character, a spinner ticking, a dropdown animating. A 1s debounce still results in dozens of `cache.set()` calls per minute on the backend.

**Why it was wrong:** The backend only needs screen context *when the user sends a message*, not continuously.

**The fix — lazy capture at send time:**
```typescript
//  GOOD — capture once, right when it's needed
const handleSend = async () => {
  const screenContext = screenContextEnabled ? captureContext() : undefined;
  await orchestratorService.sendMessage(text, ..., screenContext);
};
```

**Rule:** If a piece of data is only *read* once per user action, don't *write* it continuously. Capture on demand.

---

## Anti-Pattern 2: Always-On Polling Interval

**What was happening:**
```typescript
//  BAD — polls every 20s whether or not anything is running
useEffect(() => {
  fetchActiveTasks();
  const interval = setInterval(fetchActiveTasks, 20000);
  return () => clearInterval(interval);
}, [fetchActiveTasks]);
```

The Orchestrator page polled for active tasks unconditionally — even when the user had no workflows running. WebSocket events already call `fetchActiveTasks` on workflow completion/cancellation, so this polling was largely redundant.

**The fix — conditional interval:**
```typescript
//  GOOD — only poll while there's actually something to watch
const hasActiveTasks = backgroundTasks.some(
  t => t.status === 'running' || t.status === 'pending'
);

useEffect(() => {
  fetchActiveTasks(); // single fetch on mount
}, [fetchActiveTasks]);

useEffect(() => {
  if (!hasActiveTasks) return; // exit early when idle
  const interval = setInterval(fetchActiveTasks, 20000);
  return () => clearInterval(interval);
}, [hasActiveTasks, fetchActiveTasks]);
```

**Rule:** Polling should be proportional to urgency. When nothing is happening, don't poll. Use WebSocket push events as the primary update mechanism and polling only as a fallback while active.

---

## Anti-Pattern 3: Hardcoded WebSocket URL

**What was happening:**
```typescript
//  BAD — breaks behind any proxy, Docker port mapping, or non-8000 deployment
const wsUrl = `ws://${window.location.host.split(':')[0]}:8000/ws/buddy/?token=${token}`;
```

**The fix:**
```typescript
//  GOOD — respects deployment config, matches the pattern used by other WS hooks
const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';
const wsUrl = `${WS_BASE}/buddy/?token=${token}`;
```

**Rule:** Any URL that differs between dev and production must come from an environment variable. Never embed port numbers or hostnames in frontend code.

---

## Anti-Pattern 4: Using WebSocket for the Wrong Direction

The buddy WS had **two directions of data**, but only one of them belongs on a WebSocket:

| Direction | Content | Right transport |
|-----------|---------|----------------|
| Frontend → Backend | Screen context (url, title, interactable elements) | **POST body** — only needed at message send time |
| Backend → Frontend | `trigger_action` events (click, fill, navigate) | **WebSocket** — needs to arrive without a request |

The persistent WebSocket is the right tool for backend-initiated pushes (like `trigger_action`). For frontend-initiated data that only matters at one point in time, include it in the request body.

**Rule:** A WebSocket is a persistent bidirectional channel. Use it for: server-push events, subscriptions, or truly bidirectional real-time data. Don't use it as a continuous upload channel for data that only needs to arrive once per user action.

---

## Dead Code: Duplicate Route Registration

`Backend/buddy/routing.py` defined WebSocket URL patterns for the buddy consumer but was never imported by `asgi.py`. The route actually worked because `streaming/routing.py` separately imported `BuddyConsumer` and registered the same route. The orphaned file was a maintenance hazard — deleted April 2026.

**Lesson:** When a file is not imported anywhere, it is dead code. Django's routing system is explicit — if a routing file isn't imported in the ASGI application, its patterns don't exist regardless of what's in it. Always trace the import chain from `asgi.py` → `routing.py` → consumers.

---

## Summary: When to Use Each Transport

| Need | Use |
|------|-----|
| Request-response, user-initiated | REST (POST/GET) |
| Server pushes events to client | WebSocket |
| Large one-shot data stream from server | SSE (Server-Sent Events) |
| Frequent client→server data, any trigger | Batch it or rethink the design |
| Context needed at message send time | Include in POST body, not a WS push |

---

## Interview Questions

**Q: The chat page is making too many backend calls. How would you diagnose and fix it?**
Check for: (1) MutationObserver or scroll listeners firing on every DOM change, (2) polling intervals that run unconditionally, (3) WebSocket push loops where each message triggers another. Fix by making data capture lazy (on demand at action time), gating polling on active state, and using WebSocket only for genuine server-push events.

**Q: When would you choose WebSocket over REST for sending data to the backend?**
When the server needs to initiate communication without a client request, or when you need truly bidirectional low-latency streams. For client-initiated, one-shot data (like context at message send time), a POST is simpler, more reliable, and doesn't require a persistent connection.

**Q: Why does hardcoding a port in a WebSocket URL break production?**
In production, traffic typically goes through a reverse proxy (nginx, ALB) that listens on 80/443 and forwards internally. The browser can't reach the backend port directly. The WS URL must use the same host and port the browser sees, which is the proxy — not the internal Django port.
