# React Hooks & WebSocket Patterns

> Source: `better-n8n-frontend/src/hooks/useBuddy.ts`, `src/components/chat/StandaloneChat.tsx`
> Commits: `800c7a7`, `d11eb2d`

---

## Custom Hook: `useBuddy`

A custom hook encapsulates WebSocket lifecycle (connect, receive, cleanup) + DOM interaction logic. The component using it gets a clean interface: `{ isConnected, buddyAction, sendContextUpdate }`.

```typescript
export function useBuddy(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);       // connection handle (not state)
  const [isConnected, setIsConnected] = useState(false);
  const [buddyAction, setBuddyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;                              // conditional connection

    const token = tokenManager.getAccessToken();
    const ws = new WebSocket(`${WS_BASE}/buddy/?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'trigger_action') {
        executeAction(msg.action, msg.parameters);
      } else if (msg.type === 'context_ack') {
        // server acknowledged context update
      }
    };

    return () => { ws.close(); wsRef.current = null; }; // cleanup on unmount
  }, [enabled]);                                        // re-run if enabled changes

  return { isConnected, buddyAction, sendContextUpdate };
}
```

---

## `useRef` vs `useState` for WebSocket

This is a common interview question.

```typescript
const wsRef = useRef<WebSocket | null>(null);  //  correct
// vs
const [ws, setWs] = useState<WebSocket | null>(null);  //  problematic
```

**Why `useRef`:**
- Changing a ref does NOT trigger a re-render
- Putting the WebSocket in state would cause a render every time `setWs()` is called — which happens on connect/disconnect events — potentially creating an infinite loop
- The WebSocket is a side effect resource, not UI state

**Rule of thumb:** If a value needs to persist across renders but changing it shouldn't cause a re-render, use `useRef`. If changing it should update the UI, use `useState`.

---

## `useCallback` for Stable Function References

```typescript
const captureContext = useCallback(() => {
  // ...expensive DOM traversal
}, []);  // empty deps → stable reference (never recreated)

const sendContextUpdate = useCallback(() => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({ type: 'context_update', context: captureContext() }));
  }
}, [captureContext]);  // recreate only if captureContext changes
```

**Why `useCallback`:**
Without it, `captureContext` is recreated on every render. If it's in a `useEffect` dependency array, the effect re-runs on every render (infinite loop). `useCallback` gives you a stable function reference — same object across renders if deps don't change.

---

## WebSocket State Machine

```
CONNECTING (0) → OPEN (1) → CLOSING (2) → CLOSED (3)
```

Always check `readyState` before sending:

```typescript
if (wsRef.current?.readyState === WebSocket.OPEN) {
  wsRef.current.send(data);
}
// WebSocket.OPEN === 1, CONNECTING === 0, CLOSING === 2, CLOSED === 3
```

---

## Exponential Backoff Reconnection (production pattern)

Fixed-interval reconnect (e.g. always retry after 3s) causes a **thundering herd** when the server restarts — every client hammers it simultaneously. Exponential backoff spreads the load:

```typescript
const reconnectAttempt = useRef(0);
const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const intentionalClose = useRef(false);

ws.onclose = () => {
  setIsConnected(false);
  if (intentionalClose.current || wsRef.current !== ws) return; // see race section

  const delay = Math.min(3000 * 2 ** reconnectAttempt.current, 60000);
  // attempt 0 → 3s, 1 → 6s, 2 → 12s, 3 → 24s, 4 → 48s, 5+ → 60s (capped)
  reconnectAttempt.current += 1;
  reconnectTimer.current = setTimeout(connect, delay);
};

// In cleanup — reset on intentional close:
intentionalClose.current = true;
if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
wsRef.current?.close();
wsRef.current = null;  // ← null out before closing (see race section)
```

**Why cap at 60s?** Beyond 60s the user would think the feature is broken. 60s is a reasonable "still trying" signal.

---

## React StrictMode + WebSocket Race Condition

In **development**, React StrictMode double-invokes effects: mount → unmount → remount. This creates a subtle race with WebSocket reconnect logic:

```
1. Effect runs → intentionalClose = false → connect() → WS-A opens → wsRef = WS-A
2. StrictMode cleanup → intentionalClose = true → WS-A.close() → wsRef = null
3. Remount effect → intentionalClose = false → connect() → WS-B opens → wsRef = WS-B
4. WS-A's onclose fires (async) → intentionalClose is now false → schedules reconnect → WS-C!
```

Result: you get 2–5 simultaneous connections per mount instead of 1. **Symptom:** multiple `WebSocket CONNECT` log lines with different ports in Django within seconds of page load.

**Fix — guard `onclose` with a stale-socket check:**

```typescript
ws.onclose = () => {
  setIsConnected(false);
  // wsRef.current !== ws means a newer connection already exists → don't reconnect
  if (intentionalClose.current || wsRef.current !== ws) return;
  // ... reconnect logic
};
```

This works because when cleanup runs, we set `wsRef.current = null` before closing. By the time WS-A's `onclose` fires, `wsRef.current` is either `null` or `WS-B` — never `WS-A` — so the guard catches it.

**Rule:** Always null `wsRef.current` before calling `.close()` in cleanup. Always check `wsRef.current !== ws` at the top of `onclose`.

---

## Responsive Layout: Overlay vs Flex Sidebar

**Before (commit `d11eb2d`):** Fixed position overlay
```css
/* Overlay pattern */
.sidebar {
  position: fixed;
  top: 0; left: 0; height: 100%;
  transform: translateX(-100%);  /* hidden */
  transition: transform 0.3s;
}
.sidebar.open {
  transform: translateX(0);      /* slide in — overlaps content */
}
```

**After:** Responsive flex sidebar
```css
/* Flex sibling pattern */
.layout {
  display: flex;
}
.sidebar {
  width: 0;
  overflow: hidden;
  transition: width 0.3s;
}
.sidebar.open {
  width: 280px;   /* pushes content, doesn't overlay */
}
```

**Why the change:**
- Overlay: sidebar floats above content, content doesn't reflow — user can't see both side by side
- Flex sibling: sidebar takes up space in the layout, content shifts right — feels native, works better on tablets

**When to use overlay:** Mobile (full screen is needed, content behind sidebar wastes space)
**When to use flex sibling:** Desktop/tablet (space is available, seeing both simultaneously is useful)

---

## TypeScript Patterns Used

### Partial for optional updates
```typescript
async update(id: number, data: Partial<CreateMCPServerData>): Promise<MCPServer>
```
`Partial<T>` makes all properties of `T` optional. Use it for PATCH endpoints where only some fields are being updated.

### Generic API calls
```typescript
const response = await apiClient.get<{ servers: MCPServer[] }>('/mcp/servers/');
// response.data is typed as { servers: MCPServer[] }
```
The type parameter tells TypeScript what shape to expect from the response — you get autocomplete and type checking without extra assertions.

### Optional chaining with nullish checks
```typescript
wsRef.current?.readyState === WebSocket.OPEN
// Same as: wsRef.current !== null && wsRef.current.readyState === WebSocket.OPEN
```

---

## `dispatchEvent` for React-Compatible DOM Updates

When programmatically setting input values (for the Buddy fill action):

```typescript
el.value = params.value;
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

**Why `{ bubbles: true }`:** React attaches event listeners at the root (document level), not individual elements. Without bubbling, the event never reaches React's listener.

**Why both `input` and `change`:** 
- `input`: fires on every keystroke — React's `onChange` for inputs listens to this
- `change`: fires when focus leaves — some controlled components use this

---

## Interview Questions

**Q: What's the difference between `useRef` and `useState`?**
Both persist values across renders. `useState` causes a re-render when updated. `useRef` does not — it's a mutable container. Use `useRef` for DOM elements, timers, and resources like WebSocket connections.

**Q: How do you prevent stale closures in `useEffect`?**
Include all values used inside the effect in the dependency array. For callbacks, wrap them in `useCallback` so their reference is stable. If a value is a ref, access it inside the effect as `ref.current` — refs don't need to be in deps.

**Q: What's the correct way to clean up a WebSocket in React?**
Return a cleanup function from `useEffect` that calls `ws.close()`. This runs before the component unmounts and before the effect re-runs (if deps change).

**Q: How would you add reconnection logic to a WebSocket hook?**
Use a retry counter in a ref. On `onclose`, set a timeout that calls the connect function again, incrementing the counter. Implement exponential backoff: `delay = min(3000 * 2^attempt, 60000)`. Cap to avoid making users feel the feature is dead, but back off enough to avoid thundering herd on server restart.

**Q: React StrictMode causes my WebSocket hook to open 3–5 connections. Why and how do you fix it?**
StrictMode double-invokes effects (mount → cleanup → remount) in dev. If cleanup sets `intentionalClose = true` and closes WS-A, then remount sets `intentionalClose = false` and opens WS-B, WS-A's async `onclose` fires with `intentionalClose = false` and triggers another reconnect. Fix: null out `wsRef.current` before closing, and guard `onclose` with `if (wsRef.current !== ws) return` — by the time the stale socket closes, the ref points to the new socket (or null), so the check fails and no extra reconnect is scheduled.
