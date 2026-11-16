# Too many backend calls: capture on demand, poll only while busy

## What happened

The chat and orchestration pages sent far more requests than the work needed.
Three patterns caused most of it:

- **A `MutationObserver` on the whole page.** It watched `document.body` with
  `subtree: true`, so every React re-render, spinner and dropdown animation fired it.
  Even with a one-second debounce, the backend took dozens of cache writes a minute
  for context that was read once per message.
- **Polling that never stopped.** A page polled for active tasks every 20 seconds
  whether or not anything was running. Socket events already announced completion.
- **A socket used as an upload channel.** Screen context was pushed over a
  WebSocket continuously, although it was only needed when the user sent a message.

A hardcoded WebSocket URL with a port number also broke behind the proxy, which is
a separate fault with the same root: the URL must come from configuration.

## The fix

- **Capture on demand.** The frontend reads the context once, when the user sends
  a message, and puts it in the POST body. Nothing is captured in between.
- **Poll only while busy.** The task list polls only while a task is `running` or
  `pending`. Otherwise it fetches once on mount.
- **Use the socket only for server push.** Events the server must send without a
  request use the WebSocket. Anything the browser sends once per action goes in
  the request.
- **Configure URLs.** The WebSocket base follows the app's API origin (`lib/origins.ts`), never
  a port in the code.

Earlier, the context was a list of visible controls, each given a stable id at
capture time. That lesson carried over: when the model must act on something on
screen, give each item a stable id in the captured context. The model can then name
the item it means, and the code can find it again. Ids that only exist for one
render are not enough.

## The lesson

- **If data is read once per action, write it once per action.** Continuous capture
  is a cost paid on every change, whether anyone reads it or not.
- **Polling should follow urgency.** When nothing is happening, do not poll. Push
  events are the main channel, and polling is the fallback while work is active.
- **A socket is a persistent channel.** Use it for server push or real bidirectional
  streams. A continuous upload over a socket is almost always a POST in disguise.
- **Make the model's references stable.** An id that the model can cite and the
  code can resolve is what makes a model's action on the UI checkable.
- **Measure request counts per page load** before and after a change. A page that
  looks fine can make dozens of calls it does not need.

## Code

- `better-n8n-frontend/src/lib/websocket.ts`: the one socket primitive
- `better-n8n-frontend/src/api/`: request layer (the POST body carries per-send context)
- Transport choice in detail: `../REALTIME_AND_PROTOCOLS_SIMPLE_GUIDE.md`
