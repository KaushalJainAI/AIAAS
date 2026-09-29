# `llm/`: talking to AI models

Everything about AI model providers: which providers exist, which models they
offer, how a call is made, what it costs, and what happens when it fails.

**The one rule:** every model call in the codebase goes through
`llm/access.py`. It finds the right API key, falls back to the platform's key,
checks credits, trims the request to fit the model, and turns provider errors
into clear ones. Don't call a provider directly from anywhere else.

## Read in this order

1. `providers.py`: the list of supported providers.
2. `models.py`: `AIProvider` and `AIModel`, the model catalogue.
3. `access.py`: `preflight`, `complete`, `stream`. The funnel.
4. `handlers/openai_compatible.py`: how a request actually goes over the wire.

## Providers

`openrouter` (the default), `openai`, `nvidia`, `ollama` (local), and
`opencode` (OpenCode Zen, bring-your-own-key only). The default model is
OpenRouter's free router (`openrouter/free`), so the platform needs
`OPENROUTER_API_KEY` set.

## Data (`models.py`)

| Model | What it is |
|---|---|
| `AIProvider` | A provider row. Table name `nodes_aiprovider` (historical, pinned) |
| `AIModel` | A model in the picker, with context size, price and supported effort levels. Table `nodes_aimodel` |
| `ModelFallback`, `ModelFallbackNotice` | What to use when a model is retired, and the notice shown when that happens |

## Files

| File | What it does |
|---|---|
| `access.py` | **The funnel** for every model call |
| `providers.py` | Supported providers and their labels |
| `budget.py` | How big a request is, and how to cut it down without breaking tool-call pairs |
| `effort.py` | "How hard should the model think" levels (`none` → `high`), mapped to each provider's own setting |
| `credits.py` | The allowance a user spends when using the *platform's* key |
| `pricing.py`, `usage.py` | What a call used and what it cost |
| `fallback.py` | What runs when the chosen model is retired or unknown |
| `catalog_refresh.py` | Refreshing the model list from providers |
| `context.py` | `ExecutionContext`, extra info handed to a provider handler |
| `views.py` | `/api/llm/models/`, what the model picker reads |
| `handlers/base.py` | The interface every provider handler follows |
| `handlers/registry.py` | Finds the handler for a provider name |
| `handlers/openai_compatible.py` | One implementation of the OpenAI chat protocol (used by most providers), including retries on connection failures |
| `handlers/llm_providers.py` | OpenRouter, OpenAI, NVIDIA and OpenCode Zen, declared as settings on top of that one implementation |
| `handlers/llm_nodes.py` | Ollama (local models) |
| `handlers/llm_base.py` | Shared streaming and reasoning-text plumbing |

(`handlers/` came from the deleted `nodes` app. Some names still say "node".)

## Errors

`access.classify_provider_error` sorts failures:

- 401/403 → `LLMAccessDenied` (bad key)
- 402 or "insufficient credit" → `LLMQuotaExhausted`
- 410 or "end of life" → `LLMModelUnavailable`

All three are `LLMUserActionable`: only the user can fix them, so the turn
fails straight away with a clear message instead of showing a spinner.
Anything else is treated as temporary.

## Model ids

Never type a model id from memory. The table of ids the project relies on is
in `CLAUDE.md` ("Model IDs"). Otherwise, look it up in the `AIModel` table and
prefer a row with `is_active=True`.

The catalogue itself is `Backend/populate_models.py` — a script, run at every
backend boot, not a migration. Three things about it are worth knowing before
you edit it:

- **A price is a real input, not a label.** `input_price_per_million` and
  `output_price_per_million` are what `agents/spend.py::rupees_for` charges a
  run against and what `check_guardrails` refuses on. A stale figure does not
  look stale: it makes the picker show a wrong cost and the spend cap refuse
  runs that were affordable. Re-verify against the provider's live model list,
  which for OpenRouter is `GET https://openrouter.ai/api/v1/models` (no key
  needed) — it carries per-token pricing, the context window, input
  modalities, and the `supported_parameters` that say whether a model really
  serves `tools`, `reasoning` and `reasoning_effort`.
- **`AIModel.value` is globally unique, not unique per provider.** Two seed
  rows sharing a value do not collide loudly: the second overwrites the first
  and re-points its provider, so a model is simply *missing* from the picker
  with no error. `_assert_unique_values` fails the seed if that happens.
- **Retiring means editing two lists.** Removing a row from the provider block
  without adding it to `RETIRED_MODEL_VALUES` leaves it merely unlisted; the
  retirement list is what sets `is_active=False` and `retired_at` on an
  instance that already has the row, so an existing agent keeps a disabled row
  rather than a dangling id. `llm/catalog_refresh.py::SUGGESTED_SUCCESSORS`
  is a third list, and it rots on its own — a hint pointing at a retired model
  sends the owner to a second dead row.

`llm/tests/test_seed_catalogue.py` checks the first and second, and
`test_refresh.py::SuggestSuccessorTests` checks the third.

## Tests

`llm/tests/`: `test_effort.py`, `test_effort_funnel.py`, `test_stream_retry.py`,
`test_seed_catalogue.py` and others.
