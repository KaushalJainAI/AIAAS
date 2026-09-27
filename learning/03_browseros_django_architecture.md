# BrowserOS — Django Desktop-as-a-Service Architecture

> Source: `Backend/browserOS/models.py`, `Backend/browserOS/views.py`
> Commit: `2274705` — feat(browseros): implement desktop environment

---

## The Concept

BrowserOS is a web-based desktop environment — think Google Workspace or Notion — where each user has:
- A **Workspace** (their desktop)
- **App Windows** (running micro-apps within that workspace)
- **Notifications** (system alerts from AI agents or apps)

All of this is persisted in Django models and served via REST API + WebSocket, so the React frontend can reconstruct the OS state on any device.

---

## Data Model Design

```
User (1) ──── (1) OSWorkspace
                      │
                      └──── (many) OSAppWindow
                                    - app_id: 'explorer', 'datalab', etc.
                                    - position_x, position_y (spatial)
                                    - z_index (layering — higher = on top)
                                    - is_minimized, is_pinned (state flags)
                                    - state_data: JSONField (app-specific)

User (1) ──── (many) OSNotification
```

**Key design decisions:**

`OneToOneField` for Workspace — each user has exactly one desktop. The `get_or_create` pattern in the API ensures it's auto-created on first access.

`JSONField` for `state_data` in AppWindow — apps can store arbitrary state (e.g., currently open file path in the file explorer, active chart in DataLab) without schema changes. This is the "escape hatch" for heterogeneous app data.

`z_index` on AppWindow — the backend tracks window stacking order. When a window is focused, `z_index = max(current_z_indices) + 1`. This avoids complex client-side state synchronization.

---

## User-Scoped QuerySets (Security Pattern)

Every ViewSet filters by the authenticated user:

```python
class OSAppWindowViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        # Users can ONLY see their own windows — enforced at the ORM level
        return OSAppWindow.objects.filter(workspace__user=self.request.user)

    def perform_create(self, serializer):
        # Auto-assign workspace on creation — user never sends workspace_id
        workspace, _ = OSWorkspace.objects.get_or_create(user=self.request.user)
        serializer.save(workspace=workspace)
```

**Interview pattern: "Ownership enforcement"**
Never trust the client to send the correct `user_id` or `workspace_id`. Always derive ownership from `request.user`. This prevents IDOR (Insecure Direct Object Reference — OWASP A01).

---

## Custom ViewSet Action

```python
@action(detail=False, methods=['get'])
def mine(self, request):
    """Get or create the user's default workspace."""
    workspace, created = OSWorkspace.objects.get_or_create(user=request.user)
    serializer = self.get_serializer(workspace)
    return Response(serializer.data)
```

`@action(detail=False)` adds a route at `/workspaces/mine/` (not `/workspaces/{pk}/mine/`).
Use `detail=True` when the action applies to a single object (e.g., `/notifications/{pk}/mark_read/`).

**The `mark_all_read` bulk action:**
```python
@action(detail=False, methods=['post'])
def mark_all_read(self, request):
    self.get_queryset().update(is_read=True)  # single SQL UPDATE, not N queries
    return Response({"status": "ok"})
```

`.update()` on a QuerySet is a single `UPDATE ... WHERE ...` statement — never loop and save individually unless you need model `save()` signals.

---

## WebSocket Integration (Buddy → BrowserOS)

The Buddy AI assistant controls the BrowserOS via WebSocket events, not REST:

```python
# Backend sends an action event over Django Channels
async_to_sync(channel_layer.group_send)(
    f"buddy_{user_id}",
    {
        "type": "trigger_action",
        "action": "os_open_app",
        "parameters": {"app_id": "explorer", "window": {...}},
    }
)
```

The frontend's `useBuddy` hook listens on the same channel and dispatches the action to the React state.

**Why WebSocket instead of REST for this?**
REST is request-response — the client has to ask. WebSocket is push — the server can command the frontend in real-time. For an AI agent that's autonomously controlling a UI, push is the only viable pattern.

---

## Z-Index Management Pattern

```python
def _top_z_index(workspace: OSWorkspace) -> int:
    top = workspace.windows.order_by("-z_index").values_list("z_index", flat=True).first()
    return top or 0

# When opening/focusing a window:
window.z_index = _top_z_index(workspace) + 1
```

**Interview Q: Why not just `max_z_index + 1` in the client?**
Race condition: two browser tabs open the same app simultaneously, both read z_index=5, both set z_index=6. The backend serializes updates, so whoever writes last wins correctly. Also, `values_list("z_index", flat=True).first()` fetches just one integer, not an entire model — efficient.

---

## Django Apps Structure Insight

```
browserOS/
├── models.py       # OSWorkspace, OSAppWindow, OSNotification
├── serializers.py  # DRF serializers
├── views.py        # ModelViewSet subclasses
├── urls.py         # Router registration
├── tests.py        # API tests (user isolation tested here)
└── migrations/
```

This is the canonical Django app layout. Each app is a bounded context — BrowserOS owns only OS-related models. The Buddy app is separate and calls into BrowserOS models as a dependency.

---

## Key Interview Questions

**Q: How do you prevent one user from accessing another user's app windows?**
Enforce `filter(workspace__user=request.user)` at the QuerySet level in `get_queryset()`. DRF calls `get_queryset()` for every request, so it's impossible to bypass.

**Q: What's the difference between `select_related` and `prefetch_related`?**
`select_related` does a SQL JOIN — use it for ForeignKey/OneToOne (single object).
`prefetch_related` does a separate query + Python join — use it for ManyToMany or reverse FK (multiple objects).
Example: `OSAppWindow.objects.filter(...).select_related('workspace')` — joins workspace in one query.

**Q: When would you use JSONField vs a separate model?**
JSONField for unstructured, app-specific data that varies per record and doesn't need filtering/indexing. Separate model when you need to query on individual fields, enforce types, or create relations.
