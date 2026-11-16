# A WebSocket that opened three times: StrictMode and the stale-socket guard

## What happened

In development, a page with a live stream opened three or four WebSockets for each
mount. The Django log showed several `WebSocket CONNECT` lines within seconds of a
page load, each on a different port. Nothing failed, so it was easy to miss.

React StrictMode mounts, unmounts and remounts each effect in development. A naive
hook races with itself:

1. The first effect opens socket A and stores it in a ref.
2. StrictMode's cleanup sets `intentionalClose = true`, closes A and clears the ref.
3. The remount sets `intentionalClose = false` and opens socket B.
4. A's `onclose` fires later. The flag now says "not intentional", so A schedules a
   reconnect. That reconnect is a third socket.

## The fix

All real-time features now use one hook, `useSocket`, in
`better-n8n-frontend/src/lib/websocket.ts`. It has two rules that prevent the race:

```ts
ws.onclose = () => {
  // Stale-socket guard: a remount may have already installed a newer socket.
  if (intentionalClose.current || wsRef.current !== ws) return;
```

- In cleanup, the ref is set to `null` **before** `close()` is called. By the time a
  stale socket's `onclose` runs, the ref points at a newer socket or at nothing, so
  the guard returns early.
- Reconnects back off exponentially: `min(3000 * 2**attempt, 60000)`, from
  `backoffDelay`. The cap keeps the feature from looking dead, and the back-off
  keeps every client from reconnecting at once after a server restart.

Before this hook existed there were three different back-off policies, and only one
feature had the guard. One hook is the cure for that drift.

## The lesson

- **Keep the socket in a ref, not in state.** Changing a ref does not re-render, so
  connect and close events cannot loop.
- **Null the handle before you close it.** Any async callback from the old handle
  then sees that it is no longer current.
- **A remount is a new instance, not a retry.** Code that runs on close must ask
  whether its socket is still the active one.
- **Cap reconnect delays, and add a ceiling.** Fixed intervals hit a restarted server
  all at once. Past about a minute, users assume the feature is broken.
- **Put shared rules in one place.** Copies drift. The bugs here were in copies.

## Code

- `better-n8n-frontend/src/lib/websocket.ts`: `useSocket`, `backoffDelay`
- Transport choice (when to use a socket, SSE or a POST): see
  `../REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md`
