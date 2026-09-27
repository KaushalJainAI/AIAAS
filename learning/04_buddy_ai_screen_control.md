# Buddy AI — Screen Context & Natural Language UI Control

> Source: `Backend/buddy/views.py`, `Frontend/src/hooks/useBuddy.ts`
> Commit: `775dbab` (backend), `800c7a7` (frontend)

---

## What Was Built

Buddy is an AI assistant that can **see the current UI** and **control it** via natural language commands. You type "open the terminal" and the OS opens a terminal window. You type "show me a notification" and a notification appears. The AI can also autonomously click buttons and fill inputs on the page.

This is essentially a "computer use" / "browser automation" feature built without Playwright or Puppeteer — using only DOM queries and WebSocket events.

---

## Architecture

```
User sends chat message → frontend calls captureContext() at send time
    → screen_context attached to POST body → Chat LLM receives it in system prompt
    → LLM picks a tool (open_app / frontend_click / navigate / notify)
    → Backend executes tool → sends WebSocket event to browser
    → useBuddy hook receives trigger_action → executes DOM action
```

**Key design decision:** Context is captured **on demand** (at send time), not continuously. An earlier version used a `MutationObserver` on `document.body` to push context to the backend on every DOM change — this fired dozens of times per minute during normal React rendering, causing redundant Redis cache writes. The correct pattern is lazy capture: call `captureContext()` right before sending the message and include it in the POST body.

---

## Screen Context Capture (Frontend)

```typescript
const captureContext = useCallback(() => {
  const interactables = document.querySelectorAll(
    'button, a, input, textarea, select, [role="button"]'
  );
  const elements: any[] = [];

  interactables.forEach((el, index) => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.offsetParent === null) return; // skip hidden elements

    const buddyId = `buddy-node-${index}`;
    htmlEl.setAttribute('data-buddy-id', buddyId);  // inject stable ID

    elements.push({
      buddy_id: buddyId,
      tag: htmlEl.tagName.toLowerCase(),
      text: htmlEl.innerText?.trim() || htmlEl.getAttribute('aria-label') || '',
      type: htmlEl.getAttribute('type') || undefined,
    });
  });

  return { url: window.location.href, title: document.title, interactables: elements };
}, []);
```

**Key insight:** Elements don't have stable IDs by default, so `data-buddy-id` attributes are injected at capture time. The LLM sees these IDs in its context and references them in tool calls. The hook then does `document.querySelector('[data-buddy-id="buddy-node-42"]')` to find the element.

**`offsetParent === null` trick:** An element is visually hidden if its `offsetParent` is null (display:none on it or an ancestor). This filters out invisible elements so the LLM only sees what the user can actually interact with.

---

## WebSocket Action Execution (Frontend)

```typescript
const executeAction = useCallback((action: string, params: Record<string, any>) => {
  if (action === 'frontend_click') {
    const el = document.querySelector(`[data-buddy-id="${params.buddy_id}"]`) as HTMLElement;
    if (el) {
      el.style.outline = '4px solid #3b82f6';  // visual feedback
      setTimeout(() => {
        el.style.outline = originalOutline;
        el.click();  // programmatic click
      }, 500);
    }
  } else if (action === 'frontend_fill') {
    el.value = params.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));   // React listens to 'input'
    el.dispatchEvent(new Event('change', { bubbles: true }));  // and 'change'
  }
}, []);
```

**Why `dispatchEvent` instead of just setting `.value`?**
React uses synthetic events that wrap native DOM events. When you set `el.value = 'foo'` directly, React's controlled component doesn't know the value changed. Firing `input` and `change` events triggers React's event handlers, so the state update propagates correctly.

---

## NLP Command Resolution (Backend)

```python
APP_ALIASES = {
    "files": "explorer",
    "file explorer": "explorer",
    "terminal": "terminal",
    "buddy": "chatbot",
    "flowforge": "diagram-editor",
    # ... etc
}

def _resolve_app_id(command: str) -> Optional[str]:
    normalized = _normalize_command(command)
    # Longer aliases first — prevents "file" matching before "file explorer"
    for alias in sorted(APP_ALIASES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", normalized):
            return APP_ALIASES[alias]
    return None
```

**`\b` word boundary:** Prevents "terminal" matching inside "terminally". `re.escape` handles aliases with hyphens or spaces that would otherwise be treated as regex metacharacters.

**Sorting aliases by length (longest first):** "file explorer" (13 chars) is checked before "file" (4 chars). Otherwise "file" would always match first and "file explorer" would never trigger.

---

## WebSocket Push from Backend

```python
def _send_action_event(user_id: int, action: str, parameters: dict) -> None:
    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"buddy_{user_id}",          # per-user channel group
        {
            "type": "trigger_action",
            "action": action,
            "parameters": parameters,
        },
    )
```

Each user has their own WebSocket group `buddy_{user_id}`. The frontend's WebSocket connects to this group on mount. When the backend sends a group message, the WebSocket consumer on the frontend's connection receives it and the `useBuddy` hook dispatches the action.

**`async_to_sync`:** Django Channels consumers are async, but `buddy/views.py` is a sync DRF view. `async_to_sync` wraps the coroutine so it can be called from synchronous code. It runs the coroutine in a new event loop thread.

---

## Z-Index and Window Lifecycle (Backend)

```python
def _open_app(user, app_id: str, command_text: str) -> dict:
    workspace = _get_workspace(user)
    window = _get_window_for_app(workspace, app_id)  # check if already open
    
    if window is None:
        window = OSAppWindow.objects.create(
            workspace=workspace,
            app_id=app_id,
            z_index=_top_z_index(workspace) + 1,  # always on top
        )
    else:
        # Already open — just un-minimize and bring to front
        window.is_minimized = False
        window.z_index = _top_z_index(workspace) + 1
        window.save(update_fields=["is_minimized", "z_index", "updated_at"])
```

`update_fields` tells Django to generate `UPDATE ... SET is_minimized=..., z_index=... WHERE id=...` — only those columns, not the full model. More efficient and avoids overwriting fields you didn't intend to touch.

---

## The `useBuddy` Hook Pattern

```typescript
export function useBuddy(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);  // stable ref, not state
  const [isConnected, setIsConnected] = useState(false);
  const [buddyAction, setBuddyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ws = new WebSocket(`${WS_BASE}/buddy/`);
    wsRef.current = ws;
    ws.onopen = () => setIsConnected(true);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'trigger_action') {
        executeAction(msg.action, msg.parameters);
      }
    };
    return () => ws.close();  // cleanup on unmount
  }, [enabled]);

  return { isConnected, buddyAction, sendContextUpdate };
}
```

**`useRef` for WebSocket:** WebSocket instance goes in a ref, not state. Putting it in state would cause re-renders every time the WS state changes (open/close), potentially creating new connections in a loop.

**Cleanup function:** The `useEffect` return function closes the WebSocket when the component unmounts. Without this, stale connections accumulate.

---

## Interview Questions

**Q: How does the AI "see" the page?**
The frontend captures all visible interactive elements, assigns them stable `data-buddy-id` attributes, and sends this JSON map to the backend via WebSocket. The backend injects it into the LLM's system prompt as context. The LLM returns tool calls referencing those IDs.

**Q: Why not use Playwright/Puppeteer for browser control?**
Playwright requires a separate browser process. This approach runs entirely in the user's existing browser tab — no external process, no additional infrastructure. It also works for any frontend framework since it's pure DOM.

**Q: What's the security risk of letting AI click buttons?**
The AI could click "Delete Account" or "Confirm Payment". Mitigate by: (1) only allowing clicks on elements the user can already see, (2) adding confirmation steps for destructive actions, (3) scoping Buddy's permissions to non-destructive actions.
