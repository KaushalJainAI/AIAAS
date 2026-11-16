# `imagine/`: image, video and audio generation

The user sees this as the **Studio** page. Two ways in:

- **Form**: pick a model, write a prompt, press Generate.
- **Conversational agent**: describe what you want over the `ws/imagine-agent/`
  WebSocket. It works out the request, asks before spending, then generates.

Both use one generation path. Finished media is saved into the user's file
tree. Generation goes through OpenRouter on the user's own key.

The chat tool `generate_image` (`chat/tools/media.py`) is separate. It is the
assistant making an image in the middle of a chat.

Design: [`docs/IMAGINE.md`](../docs/IMAGINE.md).

## Data (`models.py`)

| Model | What it is |
|---|---|
| `Generation` | One generation request and its result |
| `ImagineConversation`, `ImagineMessage` | The conversational agent's chats |

## Files

| File | What it does |
|---|---|
| `services/dispatcher.py` | **The one generation path**, used by the form and the agent alike |
| `services/openrouter.py` | The OpenRouter API client |
| `services/catalog.py`, `services/capabilities.py` | Which media models exist and what each accepts. `catalog.py` also holds the speech list |
| `services/documents.py` | Saves a result as a file in the user's tree |
| `services/events.py` | Sends progress over the WebSocket |
| `agent/graph.py` | The agent's steps: understand, ask approval, generate, reply |
| `agent/intent.py` | Turns a message into a structured request |
| `agent/hitl.py` | The approval gate |
| `consumers.py` | The WebSocket for the conversational agent |
| `validation.py` | What the chosen model will actually accept |
| `tasks.py` | Background jobs (video polling) |
| `views.py`, `urls.py`, `serializers.py` | `/api/imagine/`: form, history, model capabilities |

## Rules

- Each generation is billed per call. The chat tool asks first (`sensitive`).
- Generated images carry an "AI-generated" label (`core/safety/labels.py`). Prompts are checked by the content policy and by moderation before any money is spent.

## Tests

`imagine/tests/`: `test_api.py`, `test_dispatcher.py`, `test_intent.py`, `test_catalog.py`, `test_dials.py`.
