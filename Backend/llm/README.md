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
| `balance.py` | How much credit is left on an OpenRouter key the user brought. Called by the credentials `balance` action |
| `pricing.py`, `usage.py` | What a call used and what it cost. `usage.py` reads each provider's usage object |
| `citations.py` | Turns each provider's citation format into one list of sources |
| `fallback.py` | What runs when the chosen model is retired or unknown |
| `catalog_refresh.py`, `management/commands/refresh_models.py` | Refreshes the model list from the providers |
| `decisions.py` | Decision models: typed answers (choice, yes/no, score) with probabilities. A separate door from `access.py`. Uses only the user's own key, never the platform key |
| `chatgpt_plan.py` | The ChatGPT plan's model list (per signed-in user) and its error meanings |
| `views.py`, `urls.py` | `/api/llm/models/` (the picker, plus `refresh/`), `/api/llm/fallback/`, `/api/llm/decision-models/` |
| `models.py`, `admin.py`, `apps.py` | The registry tables, Django admin, app config |
| `handlers/base.py`, `handlers/registry.py` | The handler interface, and the lookup by provider name |
| `handlers/openai_compatible.py` | The OpenAI chat protocol, used by most providers. Retries connection failures before any output |
| `handlers/llm_providers.py` | OpenRouter, OpenAI and NVIDIA, declared as settings on that one implementation |
| `handlers/responses_api.py` | The ChatGPT plan's Responses API, translated to and from the same chunks every other provider gives |
| `handlers/llm_nodes.py` | Ollama (local models) |
| `handlers/llm_base.py` | Shared streaming and reasoning-text plumbing |
| `testing.py` | A scripted model for tests. It replaces the shared HTTP client, so the funnel runs for real |
| `recorded.py` | Replays a saved provider exchange from `tests/recordings/`, for the wire formats the scripted model does not speak |

`handlers/` came from the deleted `nodes` app, so some names still say "node".

## Rules

- A provider error that only the user can fix (bad key, no credit, retired model) fails the turn at once. Anything else is treated as temporary. See `access.classify_provider_error`.
- Model ids: never type one from memory. Use the table in the Model IDs section of the root `CLAUDE.md`.
- Prices are inputs, not labels: `agents/spend.py` and the spend cap read them. Re-check against the provider's live list before editing.
- A `value` is unique across the whole catalogue. A duplicate silently drops a model from the picker. `test_seed_catalogue.py` fails on it.
- The catalogue is seeded by `../populate_models.py`, a boot script, not a migration.

## Tests

`llm/tests/`. Start with `test_scripted_model.py` (the scripted-model kit),
`test_recorded_providers.py` (each provider's wire format, replayed),
`test_no_model_fakes.py` (fails if a test fakes the model above the wire),
and `test_seed_catalogue.py`. See [`docs/TESTING.md`](../docs/TESTING.md).
