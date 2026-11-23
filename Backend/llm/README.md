# `llm/`: talking to AI models

The user sees this as the model picker, the effort control, the decision-model
picker in Settings, and the friendly messages when a provider fails. The app
holds everything about AI model providers: which exist, which models they
offer, how a call is made, what it costs, and what happens when it fails.

**The one rule:** every model call goes through `llm/access.py`. It finds the
right key, falls back to the platform key, checks credits, trims the request to
fit, and turns provider errors into clear ones. Do not call a provider from anywhere else.

## Read in this order

1. `providers.py`: the supported providers.
2. `models.py`: `AIProvider` and `AIModel`, the catalogue.
3. `access.py`: `preflight`, `complete`, `stream`. The funnel.
4. `handlers/openai_compatible.py`: how a request goes over the wire.

## Providers

`openrouter` (the default), `openai`, `nvidia`, `ollama` (local), and `chatgpt`
(your own ChatGPT plan, by sign-in; only where `CHATGPT_PLAN_ENABLED` is on).
The default model is OpenRouter's free router (`openrouter/free`), so the
platform needs `OPENROUTER_API_KEY`.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `AIProvider` | A provider row. Table `nodes_aiprovider` (historical name, pinned) |
| `AIModel` | A model in the picker: context size, price, supported effort levels. Table `nodes_aimodel` |
| `ModelFallback`, `ModelFallbackNotice` | What to use when a model is retired, and the notice shown then |

## Files

| File | What it does |
|---|---|
| `access.py` | **The funnel** for every chat and agent model call. Classifies provider errors |
| `providers.py` | Supported providers and their labels |
| `budget.py` | How big a request is, and how to cut it without breaking tool-call pairs |
| `effort.py` | Reasoning effort levels (`none` to `high`), mapped to each provider's own setting |
| `context.py` | `ExecutionContext`: extra information handed to a provider handler |
| `credits.py` | The allowance spent when a call runs on the platform's key |
| `pricing.py`, `usage.py` | What a call used and what it cost. `usage.py` reads each provider's usage object |
| `citations.py` | Turns each provider's citation format into one list of sources |
| `fallback.py` | What runs when the chosen model is retired or unknown |
| `catalog_refresh.py` | Refreshes the model list from the providers |
| `decisions.py` | Decision models: typed answers (choice, yes/no, score) with probabilities. A separate door from `access.py`. Uses only the user's own key, never the platform key |
| `chatgpt_plan.py` | The ChatGPT plan's model list (per signed-in user) and its error meanings |
| `views.py`, `urls.py` | `/api/llm/models/` (the picker) and `/api/llm/decision-models/` |
| `handlers/base.py`, `handlers/registry.py` | The handler interface, and the lookup by provider name |
| `handlers/openai_compatible.py` | The OpenAI chat protocol, used by most providers. Retries connection failures before any output |
| `handlers/llm_providers.py` | OpenRouter, OpenAI and NVIDIA, declared as settings on that one implementation |
| `handlers/responses_api.py` | The ChatGPT plan's Responses API, translated to and from the same chunks every other provider gives |
| `handlers/llm_nodes.py` | Ollama (local models) |
| `handlers/llm_base.py` | Shared streaming and reasoning-text plumbing |

`handlers/` came from the deleted `nodes` app, so some names still say "node".

## Rules

- A provider error that only the user can fix (bad key, no credit, retired model) fails the turn at once. Anything else is treated as temporary. See `access.classify_provider_error`.
- Model ids: never type one from memory. See CLAUDE.md, "Model IDs".
- Prices are inputs, not labels: `agents/spend.py` and the spend cap read them. Re-check against the provider's live list before editing.
- A `value` is unique across the whole catalogue. A duplicate silently drops a model from the picker. `test_seed_catalogue.py` fails on it.

## Tests

`llm/tests/`: `test_effort.py`, `test_effort_funnel.py`, `test_stream_retry.py`,
`test_seed_catalogue.py`, `test_decisions.py`, `test_responses_handler.py`,
`test_scripted_model.py` (the scripted-model kit).

`testing.py` is the scripted model for every app's tests: it replaces the HTTP
client at the OpenAI-compatible handler, so the funnel runs for real. See
`Backend/docs/TESTING.md`.

The catalogue is `Backend/populate_models.py`, a boot script, not a migration.
