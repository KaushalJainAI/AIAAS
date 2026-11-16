# Imagine — media generation (image / video / audio)

The `imagine` Django app routes prompts to OpenRouter for image, video and
audio. Two surfaces: a form-based REST API (Studio) and a conversational
agent flow with HITL approval (Agent).

## Architecture

```
┌────────────┐    POST /imagine/                  ┌──────────────────────┐
│ Frontend   │ ─────────────────────────────────► │ ImagineViewSet       │ (form mode)
│            │    POST /imagine/agent/chat/       │ ImagineAgentChatView │ (NL mode)
└────────────┘                                    └──────────┬───────────┘
                                                             │
                                              ┌──────────────▼────────────┐
                                              │ agent/graph.run_turn       │
                                              └──────────────┬────────────┘
                                              ┌──────────────▼────────────┐
                                              │ OpenRouterService          │
                                              │  .for_user(user) ──────────┼─► credentials vault
                                              └──────────────┬────────────┘
                                                             ▼
                                                openrouter.ai/api/v1
```

Video jobs (async) are polled by the `poll_video_generation` Celery task.
Image generation is async only when `RUN_WORKFLOWS_ASYNC` is on; otherwise
it runs inline — the same split `inference.dispatch_extraction` uses. Audio
(TTS) is always inline.

Status updates are pushed via Channels group `imagine_agent_{user_id}`
(`generation.started | progress | completed | failed`), all through
`services/events.py`, the single place the group name and frame shape live.

## Credentials

**The user's OpenRouter key lives in the encrypted `credentials/` vault**
(`slug='openrouter'`, field `apiKey`). `OpenRouterService.for_user(user)`
resolves it through `credentials.resolution`, which falls back to the
platform's `OPENROUTER_API_KEY` when the user has none. A missing key surfaces as HTTP 400 on `GET
/imagine/capabilities/` and `POST /imagine/`, a `generation.failed` WS event
in the agent flow, and `confidence=0.0` + `missing_required=['credential']`
in `classify`. Onboard at **Credentials → New → "OpenRouter API"**; no
restart needed.

## OpenRouter API surface

Base URL `https://openrouter.ai/api/v1`; headers `Authorization: Bearer
<key>`, `HTTP-Referer: https://better-n8n.com`, `X-Title: Better n8n Imagine`.

### Image — `POST /images`

One unified endpoint, not `chat/completions`: most of the catalog (FLUX,
Seedream, Recraft, …) are not chat models and are addressable only here.

```json
{ "model": "black-forest-labs/flux.2-pro", "prompt": "<prompt>",
  "resolution": "512|1K|2K|4K", "aspect_ratio": "1:1|16:9|…",
  "quality": "auto|low|medium|high", "output_format": "png|jpeg|webp|svg", "seed": 12345 }
```

Only keys the user actually set are sent, so each model's own defaults
apply. A negative prompt has no field; it is appended as `Avoid the
following: …`. Response: `data[0].b64_json` (or `data[0].url`) → a data URL;
`usage.cost` is recorded on `Generation.metadata.cost_usd`.

### Video — `POST /videos` + `GET /videos/{id}`

Async: submit returns a job; `poll_video_generation` does
`self.retry(countdown=30)`, max 20 retries, for `pending`/`in_progress`/
`error`. `completed` reads `unsigned_urls[0]` → `Generation.output_url`.
Terminal failure sets `error_message`; exhausting retries marks the row
`failed` and names the limit.

### Audio (TTS) — `POST /audio/speech`

`voice` is provider-specific and sent only when chosen (`alloy` is rejected
by MiniMax/Voxtral/Kokoro); `catalog.TTS_MODELS` carries the per-model voice
list the UI renders. `response_format` defaults to `mp3`.

### Model catalog

Image and video catalogs come from `GET /images/models` and
`GET /videos/models`; TTS has no discovery endpoint, so it is curated in
`services/catalog.py::TTS_MODELS` — edit that file when a new voice model
ships. `services/catalog.py` normalizes all three into one shape;
`capabilities.capabilities_for(user)` is the single cached accessor (key
`openrouter_capabilities_v2`, 1 h; an **empty** catalog is deliberately
never cached). `RECOMMENDED` decides which models the picker pins and what
a modality opens on.

## Cost protection

`POST /imagine/`, `POST /imagine/agent/chat/` and `POST
/imagine/agent/resume/` carry `ImagineGenerateThrottle` (scope
`imagine_generate`, **30/hour** per user, from `settings/base.py`) on top of
the global `UserRateThrottle` (1000/hour).

The HITL gate never trusts the router's `estimated_cost_usd` alone: each
modality has a floor (`agent/hitl.py::COST_FLOORS`: image 0.02, audio
0.015, video 0.30) and the gate compares `max(estimate, floor)` — the
estimate is model-generated and shares the classifier's context.

## Hardening notes

- **The classifier never 500s.** A syntactically valid but non-object
  response routes through the heuristic fallback (`agent/intent.py`).
- **Video polls stop, not spin.** `error` is retried like `pending`;
  `MaxRetriesExceededError` marks the row `failed`.
- **`?refresh=1` cannot stampede.** Concurrent refreshes are serialised by a
  short lock (`capabilities.py`); the loser serves the cache.
- **The conversation list is not N+1.** `last_message` is a `Subquery` on the
  viewset queryset.
- **Quality is only sent when the model has it** (`agent/intent.py`).

## Frontend

Two views over the same backend, toggled in the page header: **Agent**
(natural language; Auto picks modality; HITL intent card) and **Studio**
(pick everything yourself). Key pieces:

- `api/imagine.ts` — typed client; `ModelCapability` is the contract.
- `components/imagine/ModelPicker.tsx` — searchable dialog, recommended
  models pinned; `ModelRail.tsx` shows the recommended set on the page with
  a "Browse all" tile.
- `hooks/useImagineStudio.ts` — form state; every control re-snaps on model
  change.
- `components/imagine/GenerationControls.tsx` — renders only what the model
  supports; `PillSelect.tsx`, `AspectRatioSelector.tsx` (true-proportion
  previews), `StyleGallery.tsx` (style presets that append a modifier to
  the prompt at generate time).
- Completion arrives over `ws/imagine-agent/` (via `useSocket`); a 15 s poll
  remains only as a backstop while the socket is disconnected.
- The composed prompt (user text + style modifier) is what is **stored** on
  the `Generation` row, so a history entry reproduces exactly what the model
  saw.

## Code references

`imagine/services/{catalog,capabilities,openrouter,dispatcher,events}.py` ·
`imagine/agent/{graph,intent,hitl}.py` · `imagine/tasks.py` (video poller +
image task) · `imagine/consumers.py` · tests in `imagine/tests/`
(`test_catalog.py`, `test_api.py`, `test_dispatcher.py`) · credential type
seeded by `populate_credentials.py`.
