# Vision Agent — giving text-only models a witness

**Status: Phase 1 implemented.** Images, in chat, end to end. Phase 2
(rasterised visual documents) and Phase 3 (the `perception/` package for
agent runs) are not built.

The problem: a text-only model cannot read an image, and the platform used
to just give up — an honest message, but the work lands back on the user.

The idea: don't describe the image *at* the main agent. Give it **a witness
it can interrogate.** `ask_vision` is a tool whose implementation is itself
an agent — a cheap NVIDIA NIM vision model that holds the image in its own
context and answers questions about it in natural language. A caption is
written before anyone knows what will be asked; a witness is queried after.

Because the witness keeps a per-attachment transcript, follow-up questions
arrive with the first exchange already in context: cheap, coherent, and the
main agent can cross-examine.

## Where it lives

| Piece | Lives in |
|---|---|
| Witness loop, question budget, disagreement check | `chat/vision/agent.py` |
| Model + key resolution, the 404 fallthrough chain | `chat/vision/resolve.py` |
| `nemotron-parse` adapter (tool-call reply) | `chat/vision/nim.py` |
| Anti-confabulation witness prompt | `chat/vision/prompts.py` |
| `ask_vision` spec, ownership check, dispatch | `chat/tools/vision.py` |
| Offered only when a witness resolves | `requires="vision"` in `chat/tools/__init__.py` |
| Pointer instead of a dead end | `chat/turn/history.py`, `chat/turn/agent.py` |
| Main-agent discipline (BORROWED SIGHT) | `chat/turn/prompts.py` |
| Per-user model choice | `UserProfile.vision_provider` / `.vision_model` |
| Transcript, audit trail | `chat.VisionExchange` |
| Tests | `chat/tests/test_vision.py` |

## The witness chain (NIM measurements)

Measured against `integrate.api.nvidia.com`. Facts the design rests on:

- **`/v1/models` is a catalog, not an entitlement list.** Five of the
  models listed for this key returned `404 … not found for account`. So
  resolution treats 404 as "fall through to the next candidate", and
  `witness_available()` checks the chain against models the registry still
  lists as live — a dead chain withholds `ask_vision` rather than
  advertising it.
- **A timeout advances the chain** rather than aborting it — capacity is
  per model, a key is not.
- Both previous chain entries (`nvidia/nemotron-nano-12b-v2-vl`,
  `nvidia/llama-3.1-nemotron-nano-vl-8b-v1`) reached end of life on
  2026-08-26; NIM answers 410 for each.

Current chain (`chat/vision/resolve.py`):

| Model | Notes |
|---|---|
| `meta/llama-3.2-11b-vision-instruct` | default; ~1.2s |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | fallback; 503s at capacity |
| `nvidia/nemotron-parse` | the cross-check model, see below |
| `meta/llama-3.2-90b-vision-instruct` | timed out ×4 at 90s — deliberately not in the chain; a witness answers up to 6 questions per turn, and a model slower than the turn is no witness |

Resolution order: the user's `vision_provider`/`vision_model` → the chain →
nothing callable (and today's "switch model" message stands). The key comes
from `credentials.resolution.resolve_api_key` — the user's NVIDIA credential
first, `settings.NVIDIA_API_KEY` as platform fallback — the same path guest
chat uses.

## The accuracy failure that matters

On a chart with tiny labels (11px text on a 2520×1320 image), the then-default
witness read `4.8` as **`48`** — silently, plausibly, and deterministically
(three trials at `temperature=0`, identical wrong answer, so self-consistency
retries cannot catch it; zooming did not help either). `nemotron-parse`
failed the same image differently (`Revenue (USD/MN) 8.2`).

**The mitigation is disagreement as the uncertainty signal**, not retrying
and not zooming: when the VLM and the parser diverge on a number or string,
the witness says so to the main agent instead of picking one. In the
failing case they disagreed (`48` vs `8.2`); in the passing case they agreed
(`4.8`, `4.8`). `readings_diverge` ignores numbers glued to letters
("Q3" is not a `3`) — a witness that named the quarter disagreed with every
correct parse, and a signal that fires on right answers gets learned-past.

`nemotron-parse` returns its result as a **tool call**, not message
content (`message.content` is `null`; `tool_calls[0].function.arguments`
carries a `markdown_bbox` JSON array), and rejects plain-string content —
image-only content array. Both quirks are handled in `chat/vision/nim.py`.

## The witness loop (`chat/vision/agent.py`)

1. resolve the model and key (`resolve.py`)
2. load this (session, attachment) transcript from `VisionExchange`
   (`TRANSCRIPT_LIMIT = 4`)
3. call the witness — OpenAI-style `image_url` data-URL content, which NIM
   accepts as-is; no NIM-specific message shape
4. if the question asks for a number, label or verbatim text, also run
   `nemotron-parse`; if readings diverge, append a disagreement note
5. persist the exchange, return the answer

Bounds, all of which matter:

- **`MAX_QUESTIONS_PER_TURN = 6`** per attachment per turn (a `turn_id` on
  `TurnContext` counts against it).
- transcript trimmed to the last few exchanges
- timeout; failures return an error string, never raise — a dead witness
  degrades to "I could not examine that file", not a 500
- **no tools for the witness** — it looks and answers

## Persistence

`chat.VisionExchange(session, attachment, question, answer, model,
created_at)` — three jobs: the witness's memory, an audit trail of what was
asked on the user's behalf, and the data behind a "the assistant asked its
vision model N questions about this image" affordance.

## Telling the main agent the witness exists

A text-only model still never receives the file; it receives a pointer:
*"…is attached. You cannot see it. Call ask_vision with that id to question
an assistant that can."* (`partition_attachments`, `describe_for_model`).
Files nothing can read keep the user-facing "switch model" message. The main
agent's prompt carries the discipline that the answer is **testimony from
another model**, not firsthand sight: no "I can see that…", ask a follow-up
rather than fill gaps by inference, and pass on the witness's uncertainty
instead of laundering it into a clean number.

## Phases and open items

- **Phase 1 (done):** images, chat, end to end, on NIM.
- **Phase 2 (open):** visual documents — scanned PDFs and chart pages need
  a rasterizer (`pymupdf` or `pdf2image` + poppler) to reach
  `nemotron-parse`. Deliberately separated so Phase 1 did not block on it.
- **Phase 3 (open):** lift `chat/vision/` into a shared `perception/`
  package so agent runs, not only chat, can hand media to a text-only model.
- **Tool calling is not checked.** `AIModel.supports_tool_calling` is stored,
  but nothing reads it when the tools are offered, so a **main** agent on a
  model without tool calling is not stopped from being offered `ask_vision`.
- **Not fully solvable at this price point:** silent misreads of fine
  detail. The posture is to surface doubt, not claim precision.
