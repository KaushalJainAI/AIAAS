import os
import django
from copy import deepcopy
from decimal import Decimal

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "workflow_backend.settings.local")
django.setup()

from django.db import transaction
from django.utils import timezone
from llm.models import AIProvider, AIModel
from llm.providers import SUPPORTED_PROVIDERS
from llm.effort import (
    STANDARD as EFFORT_STANDARD,
    TOGGLEABLE as EFFORT_TOGGLEABLE,
)


CAPABILITY_FIELD_MAP = {
    "text_input": "supports_text_input",
    "text_generation": "supports_text_generation",
    "image_input": "supports_image_input",
    "image_generation": "supports_image_generation",
    "audio_input": "supports_audio_input",
    "audio_generation": "supports_audio_generation",
    "video_input": "supports_video_input",
    "video_generation": "supports_video_generation",
    "document_input": "supports_document_input",
    "document_generation": "supports_document_generation",
    "tabular_input": "supports_tabular_input",
    "tabular_generation": "supports_tabular_generation",
    "numeric_input": "supports_numeric_input",
    "numeric_generation": "supports_numeric_generation",
    "time_series_input": "supports_time_series_input",
    "time_series_generation": "supports_time_series_generation",
    "structured_output": "supports_structured_output",
    "tool_calling": "supports_tool_calling",
    "embedding_generation": "supports_embedding_generation",
}

DEFAULT_CAPS = {
    "text_input": True,
    "text_generation": True,
    "image_input": False,
    "image_generation": False,
    "audio_input": False,
    "audio_generation": False,
    "video_input": False,
    "video_generation": False,
    "document_input": False,
    "document_generation": False,
    "tabular_input": False,
    "tabular_generation": False,
    "numeric_input": False,
    "numeric_generation": False,
    "time_series_input": False,
    "time_series_generation": False,
    "structured_output": False,
    "tool_calling": False,
    "embedding_generation": False,
}

CHAT_CAPS = {"structured_output": True, "tool_calling": True}
VISION_CAPS = {**CHAT_CAPS, "image_input": True}
MULTIMODAL_CAPS = {
    **VISION_CAPS,
    "audio_input": True,
    "video_input": True,
    "document_input": True,
}
REASONING_CAPS = {**CHAT_CAPS, "numeric_input": True, "numeric_generation": True}


# Ids that 404 against their provider's live /models endpoint or are superseded
# by a newer tier. Checked 2026-08-24 (re-verified against OpenRouter + NIM live
# catalogs where reachable; OpenAI/Ollama ids are vendor-named and unverified).
# Deactivated rather than deleted — a saved run may still reference one.
RETIRED_MODEL_VALUES = [
    # OpenRouter — the whole kilo-auto namespace is gone
    "kilo-auto/frontier",
    "kilo-auto/balanced",
    "kilo-auto/free",
    "qwen/qwen3-coder-next:free",
    # NVIDIA NIM — delisted; NIM hosts no qwen/* at all now
    "meta/llama-3.1-405b-instruct",
    "deepseek-ai/deepseek-r1",
    "qwen/qwen3-235b-a22b",
    "microsoft/phi-4-mini-instruct",
    # Pruned 2026-08-24 — superseded by newer tier, not 404 but irrelevant.
    "deepseek/deepseek-r1",                 # superseded by deepseek-v4.1-flash
    "x-ai/grok-4.20-multi-agent",           # superseded by grok-4.6
    "qwen/qwen3-32b",                       # superseded by qwen3.8-27b dense
    "inception/mercury-2",                  # low usage, no price/perf edge vs kimi-k3
    # NIM — older Nemotron gens superseded by Nemotron 3 Nano/Super/Ultra
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "meta/llama-3.3-70b-instruct",           # superseded by llama-4 scout/maverick
    # Retired 2026-09-01. Each verified against NIM with the platform key:
    # 410 "reached its end of life" for the EOL block, 404 "not found for
    # account" for the unentitled pair. They were all still is_active=True, so
    # the model picker offered them and every pick failed at the first token.
    "nvidia/nv-embedqa-e5-v5",               # 410 — RAG embedder, EOL 2026-08-25
    "nvidia/nemotron-nano-12b-v2-vl",        # 410 — vision witness, EOL 2026-08-26
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",  # 410 — vision fallback, EOL 2026-08-26
    "deepseek-ai/deepseek-v4-pro",           # 410 — EOL on NIM
    "deepseek-ai/deepseek-v4-flash",         # 410 — EOL on NIM
    "mistralai/mistral-medium-3.5-128b",     # 410 — EOL on NIM
    # (moonshotai/kimi-k2.6 re-listed 2026-10-08: it is on OpenRouter live
    # with image input, so the NIM entitlement note no longer retires it.)
    # OpenAI direct — superseded by GPT-6 tiers
    "gpt-4o",                               # superseded by gpt-5.6-terra/sol
    "o3",                                   # superseded by o4-mini / gpt-5.6 reasoning
    # Ollama local — tiny or superseded
    "deepseek-r1:1.5b",                     # superseded by 8b/32b, too small for R1 quality
    "qwen2.5-coder:32b",                    # superseded by qwen3.6:latest,    # Pruned 2026-09-02 -- not cost-efficient / fast / intelligent, superseded by 2026-08/09 open-source wave
    "gpt-4o-mini",                          # openai provider duplicate of above
    # Gemma family -- small, not competitive vs Qwen/DeepSeek/NVIDIA (pruned per user 2026-09-02)
    # (gemma-4-31b-it is seeded; the :free variant never was and stays out.)
    "google/gemma-4-31b-it:free",
    "gemma4:latest",
    "gemma4:4b",
    # Pruned 2026-09-12 (verified against OpenRouter /v1/models live) — dead or
    # same-tier-older ids found by diffing the live catalogue against this seed.
    "qwen/qwen3.8-max",                     # 404 on OR — replaced by max-0902 snapshot
    "qwen/qwen3.8-2.4t-a95b",               # same $2/$6 tier older, superseded by max-0902
    "inception/mercury-2.5-preview",        # delisted from OR — superseded by mercury-2.5 GA
    # (muse-spark-1.2 and llama-4-maverick retired again by the ninth wave;
    # mistral-small-2603 stays seeded. o4-mini stays retired.)
    "o4-mini",                              # $1.10/$4.40 200K reasoning-only vs Luna $0.20/$1.20 1.5M
    "gpt-image-2",                          # superseded by gpt-image-2.5-sunburst/flare
    "phi4:latest",                          # local: dominated by qwen3:8b (32K, effort control)
    "mistral:7b",                           # local: dominated by qwen3:8b (newer, toggleable)
    # (The 2026-09-28 sixth wave — Sonnet 5, Grok 4.6 and all eight GPT-5.6
    # rows — briefly re-listed under the eighth-wave full catalogue, then
    # retired again by the ninth wave with the other outdated generations.)
    # Pruned 2026-10-01 (seventh wave; every OpenRouter id verified live
    # against /v1/models the same day). Two reasons, kept apart on purpose.
    # (The "beaten on price/intelligence/speed/date" half briefly re-listed
    # under the eighth-wave full catalogue, then retired again by the ninth
    # wave with the other outdated generations.)
    #
    # Text-only — the catalogue now offers only chat models that read images:
    "openrouter/pareto-code",               # text-only router, and no tool support
    "upstage/solar-mini4",
    "z-ai/glm-5.3",
    "deepseek/deepseek-v4-flash-0731",
    "nvidia/nemotron-3.5-lightning",        # the OpenRouter id; the NIM row stays as plumbing
    "inception/mercury-2.5",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/nemotron-3-nano-30b-a3b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "opencode/big-pickle",
    "opencode/deepseek-v4-flash-free",
    "opencode/ling-3.0-flash-fin-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free",
    "deepseek-r1:8b",
    "deepseek-r1:32b",
    "qwen3:8b",
    "gpt-realtime-1.5",                     # audio websocket model, never called here
    # Image input but no structured output — the output contracts
    # (`agents/contracts.py`) need it, so these stay out of the seed (the
    # refresh may still surface them as gated `live` rows):
    "thinkingmachines/inkling",             # index 25 at $1/$4.05, no structured output
    "thinkingmachines/inkling-small",       # index 26 vs DeepSeek V4.1 Flash, which is also faster
    "meta/llama-3.2-90b-vision-instruct",   # NIM: timed out at 90 s four times running
    "llama4:scout",                         # local: 18 months old, index 8
    "opencode/mimo-v2.5-free",              # superseded by mimo-v2.6-flash-free
    # OpenCode Zen was removed as a provider 2026-10-11; its last three
    # seeded rows retire with it.
    "opencode/space-bunny-free",
    "opencode/longcat-2.5-preview-free",
    "opencode/mimo-v2.6-flash-free",
    # Gone upstream 2026-10-08 (missing from /v1/models live; was the one
    # free *named* row — `openrouter/free` remains the free tier):
    "stealth/space-bunny-alpha",
    # Pruned 2026-10-08 (ninth wave) — outdated generations with a newer
    # generation covering their tier. All verified live the same day; retired
    # for being superseded, not dead.
    # Anthropic: latest per tier is Haiku 5.5 / Sonnet 5.5 / Opus 5.5.
    "anthropic/claude-fable-5",
    "anthropic/claude-fable-5.1",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-opus-4.5",
    "anthropic/claude-opus-4.6",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-opus-4.8",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-sonnet-5",
    # ByteDance: Seed 2.x current.
    "bytedance-seed/seed-1.6",
    "bytedance-seed/seed-1.6-flash",
    # DeepSeek: V4.1 Flash current.
    "deepseek/deepseek-v4-flash-vision-exp",
    # Google: 3.8 Flash + Nano Banana 2.1 + Gemma 4 current.
    "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite",
    "google/gemini-2.5-pro",
    "google/gemini-2.5-pro-preview",
    "google/gemini-3-flash-preview",
    "google/gemini-3-pro-image",
    "google/gemini-3.1-flash-lite",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.1-pro-preview-customtools",
    "google/gemini-3.5-flash",
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.6-flash",
    "google/gemini-3.7-flash",
    "google/gemma-3-12b-it",
    "google/gemma-3-27b-it",
    # xAI: Grok 4.7 current.
    "x-ai/grok-4.20",
    "x-ai/grok-4.3",
    "x-ai/grok-4.5",
    "x-ai/grok-4.6",
    # Meta: Spark 1.3 current (also the eval judge); Scout stays as reviewer.
    "meta/muse-glimmer-30b",
    "meta/muse-spark-1.1",
    "meta/muse-spark-1.2",
    "meta/muse-spark-1.2-contributor",
    "meta-llama/llama-4-maverick",
    # Xiaomi: MiMo V2.6 current.
    "xiaomi/mimo-v2.5",
    # Z.ai: GLM 5.x current.
    "z-ai/glm-4.5v",
    "z-ai/glm-4.6v",
    # Qwen: 3.7 Flash (ultra-cheap) + 3.8 line + 3-VL rows current.
    "qwen/qwen3.5-122b-a10b",
    "qwen/qwen3.5-27b",
    "qwen/qwen3.5-35b-a3b",
    "qwen/qwen3.5-397b-a17b",
    "qwen/qwen3.5-9b",
    "qwen/qwen3.5-flash-02-23",
    "qwen/qwen3.5-plus-02-15",
    "qwen/qwen3.5-plus-20260420",
    "qwen/qwen3.6-27b",
    "qwen/qwen3.6-35b-a3b",
    "qwen/qwen3.6-flash",
    "qwen/qwen3.6-plus",
    "qwen/qwen3.7-plus",
    # OpenAI: GPT-6.1 Sol + Luna + Astra current; 4.x/5.x and o-series out.
    "openai/gpt-4-turbo",
    "openai/gpt-4.1",
    "openai/gpt-4.1-mini",
    "openai/gpt-4.1-nano",
    "openai/gpt-4o",
    "openai/gpt-4o-2024-05-13",
    "openai/gpt-4o-2024-08-06",
    "openai/gpt-4o-2024-11-20",
    "openai/gpt-4o-mini",
    "openai/gpt-4o-mini-2024-07-18",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "openai/gpt-5-nano",
    "openai/gpt-5-pro",
    "openai/gpt-5.1",
    "openai/gpt-5.1-codex",
    "openai/gpt-5.1-codex-max",
    "openai/gpt-5.1-codex-mini",
    "openai/gpt-5.2",
    "openai/gpt-5.2-chat",
    "openai/gpt-5.2-codex",
    "openai/gpt-5.2-pro",
    "openai/gpt-5.3-codex",
    "openai/gpt-5.4",
    "openai/gpt-5.4-mini",
    "openai/gpt-5.4-nano",
    "openai/gpt-5.4-pro",
    "openai/gpt-5.5",
    "openai/gpt-5.5-pro",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-luna-pro",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-sol-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-terra-pro",
    "openai/gpt-6-sol",
    "openai/gpt-6-sol-pro",
    "openai/o1",
    "openai/o3",
    "openai/o3-pro",
    "openai/o4-mini",
    "openai/o4-mini-high",
    # Not callable at all:
    "sora-2-pro",                           # OpenAI switched the Sora API off on 2026-09-24
    "gpt-6-sol",                            # direct twin of the retired OpenRouter row
    "gpt-6-astra-pro",                      # Pro is a request mode on the direct API,
    "gpt-6-luna-pro",                       # not a model id — no listing carries
    "gpt-6-sol-pro",                        # any of these three
]


def m(name, value, is_free=False, caps=None, input_price="0.0000", output_price="0.0000",
      cached_price=None, context=0, cache_write_price=None, effort=(), default_effort="",
      description=""):
    """
    Helper: caps is capability dict, pricing is USD per 1M tokens as strings
    (kept as string to avoid binary float). cached_price None means no cache tier.
    context is max input tokens (0 = unknown).
    Pricing source: official provider pages + OpenRouter listings, verified 2026-08-24.

    `cache_write_price` is what the provider charges to *write* the cache, and
    None means it charges nothing — which is true of OpenAI and of every model
    served without prompt caching. Anthropic-family models routed through
    OpenRouter charge ~1.25x input to write, and folding that into the input
    rate understates exactly the long runs it is meant to bound. Note that
    `is_free=True` is load-bearing beyond display: `llm/pricing.py` reads it to
    tell a genuinely free model from one whose price nobody filled in, and only
    the latter is reported as `unpriced`.

    `effort` is which reasoning-effort rungs this model actually serves, from
    `llm.effort.LADDER`. The default is `()` — **no effort control** — and that
    is the safe default rather than a lazy one: a declared rung is a claim the
    runtime acts on by putting `reasoning_effort` on the wire, which OpenAI
    answers with a 400 for a model that does not take it. So an unverified
    model says nothing and behaves exactly as it did before the knob existed.
    `default_effort` is the rung to use when the caller names none; blank means
    the provider's own default, which is the right answer unless we have
    measured that a different rung is better for this model.
    """
    return {
        "name": name,
        "value": value,
        "is_free": is_free,
        "caps": caps or {},
        "description": description,
        "input_price_per_million": input_price,
        "output_price_per_million": output_price,
        "cached_input_price_per_million": cached_price,
        "cache_write_price_per_million": cache_write_price,
        "context_window": context,
        "effort_levels": list(effort),
        "default_effort": default_effort,
    }


def build_model_defaults(item):
    caps = {**DEFAULT_CAPS, **item.get("caps", {})}

    defaults = {
        "provider": item["provider"],
        "name": item["name"],
        "is_free": item["is_free"],
        "input_price_per_million": Decimal(str(item.get("input_price_per_million", "0.0000"))),
        "output_price_per_million": Decimal(str(item.get("output_price_per_million", "0.0000"))),
        "cached_input_price_per_million": (
            Decimal(str(item["cached_input_price_per_million"]))
            if item.get("cached_input_price_per_million") is not None else None
        ),
        "cache_write_price_per_million": (
            Decimal(str(item["cache_write_price_per_million"]))
            if item.get("cache_write_price_per_million") is not None else None
        ),
        "context_window": int(item.get("context_window", 0)),
        "effort_levels": list(item.get("effort_levels") or []),
        "default_effort": item.get("default_effort", "") or "",
    }

    for cap_key, field_name in CAPABILITY_FIELD_MAP.items():
        defaults[field_name] = caps[cap_key]

    # Only when the seed names one: an unconditional write would wipe a
    # description someone customised in admin on every boot (this script runs
    # at every backend boot).
    if item.get("description"):
        defaults["description"] = item["description"]

    return defaults


def _assert_unique_values(providers):
    """Fail the seed if two rows anywhere in the list share a `value`.

    `AIModel.value` is globally unique, not unique per provider, and
    `update_or_create` keys on `value` alone. So two seed entries sharing one —
    which is easy to write, because the id genuinely *is* the same string on
    two providers (NVIDIA's Nemotron 3 Ultra is `nvidia/nemotron-3-ultra-550b-a55b`
    on both NIM and OpenRouter) — do not raise: the second silently wins and
    re-points the row's provider FK. The result is not a duplicate in the
    picker, it is a **missing** model, with no error anywhere.

    That is exactly what happened to the OpenRouter Nemotron 3 Ultra row: it
    was seeded for months and never appeared, because the NIM entry later in
    the same list overwrote it. Nothing noticed, because the model is only
    invisible if you know it should be there.

    Raising here is the whole fix. A duplicate is always a mistake — the second
    writer's row never reaches the database — so there is no correct behaviour
    to fall back to. To serve one model on two providers, mint a distinct value.
    """
    seen: dict[str, str] = {}
    for provider_data in providers:
        for item in provider_data.get("models", ()):
            value = item["value"]
            where = seen.get(value)
            if where is not None:
                raise ValueError(
                    f"duplicate AIModel.value {value!r}: seeded under both "
                    f"{where!r} and {provider_data['slug']!r}. The value column "
                    f"is globally unique and update_or_create keys on it, so the "
                    f"second row would silently overwrite the first and the "
                    f"{where!r} model would vanish from the picker. Give one of "
                    f"them a distinct value."
                )
            seen[value] = provider_data["slug"]


def populate():
    # Catalogue reviewed 2026-08-24 with live pricing. Rule: keep the latest
    # per tier; legacy only if still widely deployed. Same provider, same tier:
    # newer wins, older goes. Pruning pass removed 14 models that were superseded
    # by a strictly better tier. See RETIRED_MODEL_VALUES.
    #
    # Addendum 2026-09-12 (second wave: DeepSeek V4.1 + surrounding updates, ids +
    # pricing verified against OpenRouter /v1/models live, modalities from the
    # list endpoint's architecture block): V4.1 Flash (official 09-10, first
    # native-multimodal DeepSeek), GPT-6 Astra Pro (reasoning.mode=pro twin),
    # Qwen3.8 Max 0902 (replaces dead `qwen3.8-max` id + older `2.4t-a95b` row),
    # Mercury 2.5 GA (preview id delisted). Deliberately NOT added: Sakana Fugu
    # Max / Ultra v2 (09-11, orchestration products over rented frontier pools,
    # not open weights — nothing to self-host or price predictably); Tencent
    # Hy4-preview / IBM Granite 4.2-8B / Ling-3.0-Flash family (preview- or
    # signal-free; no benchmark/usage case vs rows above); Kimi K2.6 (predates
    # the 09-02 wave, passed over for K2.7-Code then); DeepSeek V5 (rumor, no
    # release/model card/weights as of 09-11); all `:batch` / `:free` / `~alias`
    # variants (the seed carries none — batch is a billing mode, not a model).
    #
    # Addendum 2026-09-23 (third wave, every id verified against OpenRouter
    # /v1/models live 2026-09-23): GPT-5.6 Pro twins (Luna/Terra Pro —
    # reasoning.mode=pro, same price as base), the GPT-6 family beyond Astra
    # (Luna $0.10/$0.50 undercuts 5.6 Luna at the same 1.05M ctx; Sol $2/$10;
    # no Terra tier exists), Thinking Machines Inkling + Small (first US
    # open-weights contender, no effort claim — unverified on OR), Qwen3.8
    # Omni Flash (omni sibling of 3.8 Flash, same $0.15/$0.47), Xiaomi MiMo
    # V2.6 Flash + Pro. Retired in the same pass: 4o-mini x2, 3.1-pro-preview,
    # old V4 Pro/Flash rows (were created-then-retired each boot), 1.2
    # standard, o4-mini, Mistral Small, Llama 4 Maverick, the whole 5.6 Sol
    # line (GPT-6 Sol holds $2/$10, same price, newer) — each loses on price,
    # speed, intelligence and cutoff to a row that stays.
    # Deliberately NOT added: DeepSeek V5 (rumor — no changelog entry, model
    # string or weights as of 2026-09-23), Mythos 5.1 (invite-only Glasswing),
    # Jev 1.13 (its own endpoint, not chat-completions),
    # :free/:batch variants and Granite/Ling/Laguna ultra-cheap rows
    # (signal-free vs Qwen3.7 Flash at $0.03).
    #
    # Addendum 2026-09-23 (fourth wave): Claude Opus 5.5 (GA 2026-09-22,
    # $4/$20 cached $0.20 write $5, Jun 2026 cutoff, default effort medium —
    # Fable-5.1-level at ~40% under Opus 5); Opus 5 + base Fable 5 retired,
    # Fable 5.1 kept as the latest Fable. Media: GPT Image 2 → 2.5 Sunburst +
    # Flare (both live on /images/models); Imagine RECOMMENDED re-curated
    # against live /images + /videos (Flux.2 Max, Muse Image, MAI-Image-2.6
    # Flash, Nano Banana 2 Lite, Hailuo 3 Max over Hailuo 3, Wan 3.0 pair,
    # FLUX.3 Video, Kling Std, Veo Lite). Audio unchanged — Speech 2.8 is
    # still the current TTS family, nothing newer shipped.
    #
    # Addendum 2026-09-23 (fifth cut — cost/speed/intelligence audit of all 87
    # active rows): retired 1.2-contributor (same billing as 1.3-contributor),
    # vision-exp (beaten by V4.1), 3.7-flash (same price as 3.8), grok-4.5
    # (same price as 4.6), k2.7-code + glimmer-30b (both lose to minimax-m3),
    # phi4 + mistral:7b (qwen3:8b covers local-small). Kept deliberately:
    # 1.3-standard (private, no training — the contributor's price costs
    # privacy), step-3.7-flash (only $0.20 row with audio+video in), sonnet-5
    # (Claude Free/Pro default, widely deployed), grok-4.6 (xAI option),
    # kimi-k3 (design-arena leader), qwen3.8-27b (dense self-hostable).
    #
    # Addendum 2026-09-28 (sixth wave). Eight rows in, ten out, and — the part
    # that actually mattered — **eleven existing rows re-priced from the live
    # OpenRouter /v1/models endpoint**, because a catalogue that has drifted
    # from what it bills is worse than one that is short: every one of those
    # numbers feeds `agents/spend.py::rupees_for`, so `check_guardrails` was
    # refusing runs it could afford and `credits_used` was reporting a spend
    # nobody incurred. The worst was `z-ai/glm-5.3`, carrying its 2026-08-14
    # launch price of $1.40/$4.40 against a live $0.1785/$2.805 — an 8x
    # overstatement on the input side, and `deepseek/deepseek-v4.1-flash`
    # carrying $0.15/$0.60 against a live $0.30/$1.20, an understatement on
    # the row this file's own benchmarks run against.
    #
    # Added: Space Bunny Alpha (the `stealth/` free row, 1M ctx, multimodal and
    # tool-calling — the one free model here that is named rather than a
    # lottery, since `openrouter/free` promises nothing about which model you
    # get or how much context it has), Space Bunny Free on Zen, Claude Sonnet
    # 5.5, Grok 4.7, Qwen3.7 Plus, Qwen3.8 Max Prime, Upstage Solar Mini 4
    # (the only row declaring `parallel_tool_calls`, which `tools_node`'s
    # gather pass depends on) and ByteDance Seed 2.1 Turbo (the strongest
    # non-English option we serve).
    #
    # Retired: Sonnet 5 and Grok 4.6, and all eight GPT-5.6 rows. The bar was
    # *strict* domination, not parity — a row that merely ties is still a
    # second price for the same model in the picker. Sonnet 5.5 is the same
    # $2/$10 as Sonnet 5 at the same 1M; Grok 4.7 is $1.60/$4.80 against
    # $2/$6 *and* better on AA-Briefcase (+111 Elo) and CursorBench 4.0; and
    # every GPT-5.6 tier is beaten by the GPT-6 tier that replaced it (Luna
    # $0.10/$0.50 vs $0.20/$1.20, Sol $2/$10 vs Terra $2/$12).
    #
    # Deliberately NOT added, for the reasons the previous passes gave: Ling
    # 3.0 Flash and Flash-VL (passed over twice already for having no usage
    # signal, and at $0.021/$0.06 with 262K ctx they undercut Qwen3.7 Flash
    # only on a dimension we already win on); Poolside Laguna S 2.1 (a real
    # coding model at $0.09/$0.18 with 1M ctx, but it serves no
    # `response_format` or `structured_outputs`, and this platform grades on
    # structured output — an unclaim there withholds the toolbox); Solar Pro 4
    # and Qwen3.7 Max (same tier as rows that stay, at 3-6x the price);
    # Grok Build 0.1 and Seed 2.0 Code (a second coding row for a capability
    # Laguna covers); GLM 5.3 Prime and Kimi K2.6/K2.5 (dominated); every
    # `gemma-*` and `ministral-*` row (the Gemma family was pruned 2026-09-02
    # and nothing has changed it; Ministral does not serve `reasoning_effort`
    # at all); and all `:free` / `:batch` / `~alias` variants, as before —
    # `openrouter/free` and the two free named rows cover the free tier.
    #
    # Addendum 2026-10-01 (seventh wave). The rule changed, so the catalogue
    # shrank: **a chat model is offered only if it reads images**, and a row
    # stays only if it is very cheap for what it does, very capable, or very
    # fast — latest generation first. Every OpenRouter id, price, window and
    # modality below was read from the live /v1/models endpoint on 2026-10-01
    # (462 models); intelligence and speed figures are the Artificial Analysis
    # Intelligence Index and its measured tokens/second from the same week.
    #
    # In: GPT-6.1 Sol and its Pro twin (2026-09-29, same $2/$10 as GPT-6 Sol,
    # index 51.8 against 47.5), MiMo V2.6 Pro UltraSpeed (the fast serving of
    # the Pro checkpoint), Ling 3.0 Flash VL (the cheapest image-reading row),
    # LongCat 2.5 Preview on Zen, and Qwen 3.8 27B + Qwen 3.5 9B locally.
    #
    # Out, text-only: Pareto Code Router, Solar Mini 4, GLM-5.3, DeepSeek V4
    # Flash 0731, Nemotron 3.5 Lightning (OpenRouter), Mercury 2.5, the NIM
    # Nemotron Ultra/Nano and GPT-OSS pair, five of the Zen rows, DeepSeek R1
    # and Qwen 3 8B on Ollama, GPT Realtime 1.5.
    #
    # Out, beaten on price, intelligence, speed and release date by a row that
    # stays: GPT-6 Sol (by 6.1 Sol), GPT-6 Astra and Claude Fable 5.1 (both
    # $10/$50 and both under Opus 5.5 at $4/$20, 57.6 on the index), Claude
    # Haiku 4.5 (index 17 at $1/$5), Qwen3.8 Max 0902 and Max Prime (index 45
    # at 39 tok/s against Muse Spark 1.3 at 48 and 174 tok/s for less), Qwen3.8
    # 27B, Qwen3.7 Plus (index 25), Qwen3.8 Omni Flash (a second row at the
    # 3.8 Flash price), Kimi K3 (index 44 at 34 tok/s and $10 out, against
    # MiMo V2.6 Pro at 46 and $0.87), MiniMax M3, Step 3.7 Flash, both Inkling
    # rows, Seed 2.1 Turbo (loses three of four shared benchmarks to GLM-5.3
    # Flash at over three times the price) and Llama 3.2 90B Vision (times
    # out). Sora 2 Pro went because OpenAI switched the Sora API off on
    # 2026-09-24. The direct-OpenAI `-pro` ids went because Pro is a request
    # mode there, not a model id.
    #
    # Deliberately NOT added: Gemini 4 Argon and Step 5 Preview (not on
    # OpenRouter), the GPT-5.6 line (some boards still rank 5.6 Sol first, but
    # it is the previous generation and the sources disagree), Ember-1 ($3/$15
    # on top of Kimi K3), Command A+ (index 13), GLM-5.3 FlashX and Nex N2.5
    # (no independent measurement yet), Fugu (an orchestration product), and
    # every `:free` / `:batch` / `~alias` variant, as before. On NIM,
    # DeepSeek V4.1 Flash and Kimi K3 are listed but both timed out at 90 s
    # with the production key, so neither is seeded there.
    #
    # Three text-only rows stay because the platform itself calls them — the
    # context fold and guest model, and the two handler defaults. They are
    # active (a retired row is substituted by `llm/fallback.py`) and are kept
    # out of the picker by `llm/views.py::offered_in_picker`.
    #
    # Addendum 2026-10-08 (eighth wave — full catalogue). The rule changed
    # again, at the user's direction: seed **every** live OpenRouter id with
    # image input + tool calling + structured output (173 rows, read from the
    # live /v1/models endpoint the same day: 467 models, 359 after dropping
    # the `:free`/`:batch`/`:nitro`/`:online`/`:floor`/alias variants),
    # including the 41 rows earlier waves pruned as superseded or
    # non-competitive. A model that is live, reads images and can call tools
    # is offered; ranking it is the picker's job, not the seed's. Still out:
    # text-only ids (the image-input rule stands), the 9 image+tools rows
    # with no structured output (Inkling pair, Opus 4.1, Sonnet 4, the four
    # Nova rows, Pareto 26.10 Preview — the output contracts need it), and
    # the text-only routers (Pareto Code, Fusion, Bodybuilder).
    #
    # New since 2026-10-01: Claude Haiku 5.5 (2026-10-07, $0.10/$0.50 base
    # tier up to 100K prompt, then $0.50/$2.50 — the seed carries the base
    # tier; first Haiku with effort settings, default medium, AA index 43)
    # and Mistral Large 4 (2026-10-06 public preview, MoE, preview sale
    # $0.68/$2.09). Both read images and call tools, both verified live.
    #
    # Re-priced from live: Sonnet 5.5 cache reads halved $0.20 -> $0.10
    # (Anthropic cut them 2026-10-07, ~20% cheaper agentic work) and DeepSeek
    # V4.1 Flash up to $0.0351/$1.00 cached $0.01 (the cheapest of 32
    # endpoints moved; the median is ~$0.21/$0.80). Gone: Space Bunny Alpha
    # (delisted upstream — `openrouter/free` is the free tier again). Nano
    # Banana 2.1 reads images and calls tools so it seeds as a chat row at
    # its text rates; its per-image output billing is not represented here.
    #
    # Addendum 2026-10-08 (ninth wave — retire the outdated generations).
    # The full catalogue flooded the picker with prior generations (GPT-4o,
    # the whole GPT-5 line, Gemini 2.5–3.7, Claude 4.x, Qwen 3.5/3.6), so
    # ~96 rows retire again under one rule: a newer generation from the same
    # vendor covers the tier. What stays is latest per family plus the cheap
    # and fast picks — Haiku/Sonnet/Opus 5.5, GPT-6.1 Sol + Luna + Astra,
    # Gemini 3.8 Flash, Grok 4.7, Spark 1.3, MiMo V2.6, DeepSeek V4.1 Flash,
    # GLM-5.3 Flash, Qwen 3.7/3.8 Flash, Ling VL, Haiku 5.5, Mistral Large 4
    # and the current single-vendor rows. Dated snapshots go with the base
    # id they snapshot (retiring gpt-4o but keeping gpt-4o-2024-05-13 would
    # be nonsense). Successor hints in `llm/catalog_refresh.py` cover every
    # newly retired id whose target is obvious (minis to Luna, pros to Sol
    # Pro, everything else to the family's current row).
    #
    # Effort stays declared only where verified
    # (Haiku 5.5 joins Opus/Sonnet 5.5 as TOGGLEABLE; Mistral Large 4 is
    # STANDARD); the other ~150 rows carry none, which is the safe silence.
    #
    # Coverage target (seventh wave, kept for the curated reasoning): every
    # user can pick along three axes without duplicates:
    #   intelligence — Opus 5.5 (57.6) / Sonnet 5.5 (56.0) / GPT-6.1 Sol (51.8)
    #                  / Muse Spark 1.3 (48.1) / Grok 4.7 (46.5)
    #   cost — $0 (Free Router) -> $0.021/$0.06 (Ling VL)
    #          -> $0.03/$0.13 (Qwen3.7 Flash) -> $0.10/$0.20 (Muse Contributor)
    #          -> $0.435/$0.87 (MiMo V2.6 Pro, index 46)
    #   speed — Gemini 3.8 Flash (~220 tok/s) / DeepSeek V4.1 Flash (~209)
    #           / Muse Spark 1.3 (~174) / Ling VL (~142) / GPT-6 Luna (~125)
    #
    # Pricing is USD per 1M tokens, cached price is cache-hit input where the
    # provider bills it (Anthropic, OpenAI, DeepSeek, Qwen). Local Ollama is $0.
    # Sources checked 2026-08-24, re-verified against the live OpenRouter
    # /v1/models endpoint 2026-09-28 (460 models, 300 after dropping the
    # `:free`/`:batch`/`:nitro`/`:online`/`:floor`/alias variants):
    #   Anthropic: platform.claude.com/docs/en/about-claude/pricing
    #   OpenAI: openai.com/index/gpt-5-6 + developers.openai.com pricing
    #   Google: blog.google Gemini 3.7 Flash post + Vertex pricing
    #   DeepSeek: api-docs.deepseek.com + mercatus Aug 16 peak/off-peak
    #   xAI: x.ai/news/grok-4-7 (2026-09-21) + docs.x.ai
    #   OpenRouter listings for Qwen, Llama, Grok, Mistral, Kimi, Nemotron,
    #     Upstage, ByteDance, xAI, Thinking Machines, Xiaomi
    #
    # OpenRouter and NVIDIA NIM entries were checked against live /models
    # endpoints where reachable — every id returned 200. OpenAI/Ollama ids are
    # vendor-named and unverified: a wrong id fails closed with a 404 at call time.
    # Reasoning effort (added 2026-09-03). `effort=` declares which rungs a row
    # actually serves; omitting it means **no effort control**, which is the
    # default for every row above that does not name one. That asymmetry is
    # deliberate: a declared rung causes `reasoning_effort` (or OpenRouter's
    # `reasoning` object) to go on the wire, and OpenAI answers that with a 400
    # for a model that does not take it, so silence has to be the safe answer.
    #
    # Two families, by what the model can actually be asked:
    #   EFFORT_STANDARD   — low/medium/high, no way to switch thinking off.
    #   EFFORT_TOGGLEABLE — hybrid checkpoints that serve a thinking and a
    #                       non-thinking mode, so `none` is a real request.
    #                       Only OpenRouter and Ollama can express it on the
    #                       wire; through NIM it degrades to the cheapest rung.
    #
    # A third existed and left on 2026-09-28: `EFFORT_WITH_MINIMAL`, the rung
    # below `low` that the GPT-5.6 tiers served. No row in the catalogue claims
    # it now, and that is the point — the GPT-6 family took those tiers' place
    # without it, so keeping the declaration would put `reasoning_effort:
    # minimal` on the wire for a model that answers 400. The constant stays in
    # `llm/effort.py` for the next provider that offers it.
    #
    # Every row is left at `default_effort=""` — the provider's own default. A
    # default chosen here would silently change what an unconfigured call costs,
    # and nothing above has been measured well enough to justify that.
    providers = [
        {
            "name": "OpenRouter",
            "slug": "openrouter",
            "description": "Unified AI gateway for routing across hosted model providers.",
            "icon": "OR",
            "models": [
                # --- Routing (price varies by routed model; 0 here) ---
                # The routers carry `EFFORT_STANDARD` even though *which* model
                # answers is decided upstream per request. `reasoning` is an
                # OpenRouter-level abstraction: it accepts the field on a router
                # and maps it onto whatever it routes to, dropping it for a
                # model that has no such knob. So the rung is a request rather
                # than a guarantee here — which is the most a router can offer,
                # and strictly better than withholding the control on the model
                # a new chat starts on. No `none`: a router cannot promise the
                # model it picks is one whose thinking can be switched off.
                #
                # All four take images (verified 2026-10-08 against OpenRouter
                # /v1/models live: auto/auto-beta are text+image+file+audio+
                # video, free is text+image, jev-router is text+image+file+
                # audio+video), so all pass the image-input rule. Pareto Code,
                # Fusion and Bodybuilder are text-only with no tool support and
                # stay out (pareto-code retires below).
                m("Auto Router", "openrouter/auto", caps=MULTIMODAL_CAPS, input_price="0.0000", output_price="0.0000", context=2000000, effort=EFFORT_STANDARD),
                m("Auto Router (Beta)", "openrouter/auto-beta", caps=MULTIMODAL_CAPS, input_price="0.0000", output_price="0.0000", context=2000000, effort=EFFORT_STANDARD),
                m("Free Models Router", "openrouter/free", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=200000, effort=EFFORT_STANDARD),
                # --- Third-party router ---
                m("TypeSafe Jev Router", "typesafe/jev-router", caps=MULTIMODAL_CAPS, input_price="0.0000", output_price="0.0000", context=1000000, effort=EFFORT_STANDARD),
                # --- Full catalogue (eighth wave, 2026-10-08; pruned ninth wave) ---
                # Every live OpenRouter id with image input + tool calling +
                # structured output (173 rows, verified against /v1/models live
                # 2026-10-08, 467 models), minus the outdated generations the
                # ninth wave retired below (prior-gen rows with a newer
                # generation covering their tier). Names, prices, cache tiers
                # and context windows are the live figures; caps follow the
                # live input modalities; effort stays empty except where
                # verified (a declared rung puts `reasoning_effort` on the
                # wire, so an unverified claim is a 400, not a feature).
                # --- anthropic (latest per tier; older generations retire below) ---
                m("Anthropic Claude Haiku 5.5", "anthropic/claude-haiku-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1000000, effort=EFFORT_TOGGLEABLE, default_effort="medium", description="Cheapest fast Claude: $0.10/$0.50 up to 100K prompt, then $0.50/$2.50 - the seed carries the base tier."),
                m("Anthropic Claude Opus 5.5", "anthropic/claude-opus-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="4.0000", output_price="20.0000", cached_price="0.2000", cache_write_price="5.0000", context=1000000, effort=EFFORT_TOGGLEABLE, default_effort="medium"),
                m("Anthropic Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- bytedance-seed (2.x current; 1.6 retired below) ---
                m("ByteDance Seed 2.1 Turbo", "bytedance-seed/seed-2-1-turbo", caps={**VISION_CAPS, "video_input": True}, input_price="0.5000", output_price="2.5000", context=262144),
                m("ByteDance Seed-2.0-Code", "bytedance-seed/seed-2.0-code", caps={**VISION_CAPS, "video_input": True}, input_price="0.5000", output_price="3.0000", context=262144),
                m("ByteDance Seed-2.0-Lite", "bytedance-seed/seed-2.0-lite", caps={**VISION_CAPS, "video_input": True}, input_price="0.2500", output_price="2.0000", context=262144),
                m("ByteDance Seed-2.0-Mini", "bytedance-seed/seed-2.0-mini", caps={**VISION_CAPS, "video_input": True}, input_price="0.1000", output_price="0.4000", context=262144),
                # --- cohere ---
                m("Cohere Command A+", "cohere/command-a-plus", caps=VISION_CAPS, input_price="0.3000", output_price="1.5000", cached_price="0.1500", context=192000),
                # --- deepseek (V4.1 Flash current; vision-exp retired below) ---
                m("DeepSeek V4.1 Flash", "deepseek/deepseek-v4.1-flash", caps=VISION_CAPS, input_price="0.0351", output_price="1.0000", cached_price="0.0100", context=1048576, effort=EFFORT_TOGGLEABLE, description="Cheapest of 32 serving endpoints; the median is ~$0.21/$0.80. Real spend is taken from usage.cost wherever reported."),
                # --- fireworks ---
                m("Fireworks Ember-1", "fireworks/ember-1", caps=VISION_CAPS, input_price="3.0000", output_price="15.0000", cached_price="0.3000", context=1048576),
                # --- google (3.8 Flash + Nano Banana 2.1 current; older gens retire below) ---
                m("Google Gemini 3.8 Flash", "google/gemini-3.8-flash", caps={**VISION_CAPS, "video_input": True, "audio_input": True, "document_input": True}, input_price="0.7500", output_price="3.7500", cached_price="0.0750", cache_write_price="0.0417", context=1048576, effort=EFFORT_STANDARD),
                m("Google Nano Banana 2.1", "google/gemini-nano-banana-2.1", caps=VISION_CAPS, input_price="1.5000", output_price="7.5000", context=65536),
                # Gemma 4 current; Gemma 3 retired below.
                m("Google Gemma 4 26B A4B", "google/gemma-4-26b-a4b-it", caps={**VISION_CAPS, "video_input": True}, input_price="0.0900", output_price="0.3000", cached_price="0.0500", context=262144),
                m("Google Gemma 4 31B", "google/gemma-4-31b-it", caps={**VISION_CAPS, "video_input": True}, input_price="0.0900", output_price="0.3400", cached_price="0.0500", context=262144),
                # --- inclusionai ---
                m("inclusionAI Ling 3.0 Flash VL", "inclusionai/ling-3.0-flash-vl", caps={**VISION_CAPS, "video_input": True}, input_price="0.0210", output_price="0.0616", cached_price="0.0042", context=262144),
                # --- meta ---
                # --- meta (Spark 1.3 current, also the eval judge; older gens retire below) ---
                m("Meta Muse Spark 1.3", "meta/muse-spark-1.3", caps={**VISION_CAPS, "video_input": True, "document_input": True}, input_price="1.2500", output_price="4.2500", cached_price="0.1500", context=1048576),
                m("Meta Muse Spark 1.3 Contributor", "meta/muse-spark-1.3-contributor", caps={**VISION_CAPS, "video_input": True, "document_input": True}, input_price="0.1000", output_price="0.2000", cached_price="0.0020", context=1048576),
                # --- meta-llama (Scout stays: the chat `auto` reviewer; Maverick retired below) ---
                m("Meta Llama 4 Scout", "meta-llama/llama-4-scout", caps=VISION_CAPS, input_price="0.1000", output_price="0.3000", context=1310720),
                # --- minimax ---
                m("MiniMax M3", "minimax/minimax-m3", caps={**VISION_CAPS, "video_input": True}, input_price="0.3000", output_price="1.2000", cached_price="0.0600", context=1048576),
                # --- mistralai ---
                m("Mistral Ministral 3 14B 2512", "mistralai/ministral-14b-2512", caps=VISION_CAPS, input_price="0.2000", output_price="0.2000", cached_price="0.0200", context=262144),
                m("Mistral Ministral 3 3B 2512", "mistralai/ministral-3b-2512", caps=VISION_CAPS, input_price="0.1000", output_price="0.1000", cached_price="0.0100", context=131072),
                m("Mistral Ministral 3 8B 2512", "mistralai/ministral-8b-2512", caps=VISION_CAPS, input_price="0.1500", output_price="0.1500", cached_price="0.0150", context=262144),
                m("Mistral Large 3 2512", "mistralai/mistral-large-2512", caps={**VISION_CAPS, "document_input": True}, input_price="0.5000", output_price="1.5000", cached_price="0.0500", context=262144),
                m("Mistral Large 4", "mistralai/mistral-large-4-0", caps=VISION_CAPS, input_price="0.6800", output_price="2.0900", cached_price="0.0700", context=524288, effort=EFFORT_STANDARD, description="Mistral Large 4 public preview (2026-10-06): open-weight-bound MoE, preview sale $0.68/$2.09."),
                m("Mistral Medium 3", "mistralai/mistral-medium-3", caps={**VISION_CAPS, "document_input": True}, input_price="0.4000", output_price="2.0000", cached_price="0.0400", context=131072),
                m("Mistral Medium 3.5", "mistralai/mistral-medium-3-5", caps={**VISION_CAPS, "document_input": True}, input_price="1.5000", output_price="7.5000", context=262144),
                m("Mistral Medium 3.1", "mistralai/mistral-medium-3.1", caps={**VISION_CAPS, "document_input": True}, input_price="0.4000", output_price="2.0000", cached_price="0.0400", context=131072),
                m("Mistral Small 4", "mistralai/mistral-small-2603", caps=VISION_CAPS, input_price="0.1500", output_price="0.6000", cached_price="0.0150", context=262144),
                m("Mistral Small 3.1 24B", "mistralai/mistral-small-3.1-24b-instruct", caps=VISION_CAPS, input_price="0.3510", output_price="0.5550", context=128000),
                m("Mistral Small 3.2 24B", "mistralai/mistral-small-3.2-24b-instruct", caps=VISION_CAPS, input_price="0.0938", output_price="0.2500", context=256000),
                # --- moonshotai ---
                m("MoonshotAI Kimi K2.5", "moonshotai/kimi-k2.5", caps=VISION_CAPS, input_price="0.4500", output_price="2.2500", cached_price="0.0700", context=262144),
                m("MoonshotAI Kimi K2.6", "moonshotai/kimi-k2.6", caps=VISION_CAPS, input_price="0.4650", output_price="2.4500", cached_price="0.0975", context=262144),
                m("MoonshotAI Kimi K2.7 Code", "moonshotai/kimi-k2.7-code", caps=VISION_CAPS, input_price="0.6712", output_price="3.3500", cached_price="0.1800", context=262144),
                m("MoonshotAI Kimi K3", "moonshotai/kimi-k3", caps={**VISION_CAPS, "video_input": True}, input_price="0.6200", output_price="12.3000", cached_price="0.4300", context=1048576),
                # --- nex-agi ---
                m("Nex-N2.5-Pro", "nex-agi/nex-n2.5-pro", caps=VISION_CAPS, input_price="0.0750", output_price="0.2500", cached_price="0.0150", context=262144),
                # --- openai (GPT-6.1 Sol + Luna current, Astra flagship; 4.x/5.x
                # and the o-series retire below, GPT-6 Sol superseded by 6.1) ---
                m("OpenAI GPT-6 Astra", "openai/gpt-6-astra", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000),
                m("OpenAI GPT-6 Astra Pro", "openai/gpt-6-astra-pro", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000),
                m("OpenAI GPT-6 Luna", "openai/gpt-6-luna", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6 Luna Pro", "openai/gpt-6-luna-pro", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6.1 Sol", "openai/gpt-6.1-sol", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6.1 Sol Pro", "openai/gpt-6.1-sol-pro", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT Chat Latest", "openai/gpt-chat-latest", caps={**VISION_CAPS, "document_input": True}, input_price="5.0000", output_price="30.0000", cached_price="0.5000", context=400000),
                # --- perceptron ---
                m("Perceptron Mk1.5", "perceptron/perceptron-mk1.5", caps={**VISION_CAPS, "video_input": True, "audio_input": True}, input_price="0.1500", output_price="1.5000", context=36864),
                # --- prism-ml ---
                m("PrismML Ternary Bonsai 2 27B", "prism-ml/ternary-bonsai-2-27b", caps=VISION_CAPS, input_price="0.0750", output_price="0.5000", cached_price="0.0375", context=262144),
                # --- qwen ---
                m("Qwen3 VL 235B A22B Instruct", "qwen/qwen3-vl-235b-a22b-instruct", caps=VISION_CAPS, input_price="0.2100", output_price="1.9000", cached_price="0.1000", context=262144),
                m("Qwen3 VL 235B A22B Thinking", "qwen/qwen3-vl-235b-a22b-thinking", caps=VISION_CAPS, input_price="0.4000", output_price="4.0000", context=131072),
                m("Qwen3 VL 30B A3B Instruct", "qwen/qwen3-vl-30b-a3b-instruct", caps=VISION_CAPS, input_price="0.1500", output_price="0.6000", context=262144),
                m("Qwen3 VL 30B A3B Thinking", "qwen/qwen3-vl-30b-a3b-thinking", caps=VISION_CAPS, input_price="0.2000", output_price="2.4000", context=262144),
                m("Qwen3 VL 32B Instruct", "qwen/qwen3-vl-32b-instruct", caps=VISION_CAPS, input_price="0.1040", output_price="0.4160", context=131072),
                m("Qwen3 VL 8B Instruct", "qwen/qwen3-vl-8b-instruct", caps=VISION_CAPS, input_price="0.1170", output_price="0.4550", context=262144),
                m("Qwen3 VL 8B Thinking", "qwen/qwen3-vl-8b-thinking", caps=VISION_CAPS, input_price="0.1800", output_price="2.1000", context=131072),
                # Qwen 3.5/3.6 lines retired below; 3.7 Flash stays as the
                # ultra-cheap long-context pick, 3.7 Plus retires (covered by
                # 3.8 Flash at a lower price).
                m("Qwen3.7 Flash", "qwen/qwen3.7-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.0300", output_price="0.1300", cached_price="0.0060", cache_write_price="0.0380", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Qwen3.8 27B", "qwen/qwen3.8-27b", caps={**VISION_CAPS, "video_input": True}, input_price="0.4250", output_price="2.5500", cached_price="0.0850", cache_write_price="0.5312", context=1000000),
                m("Qwen3.8 Flash", "qwen/qwen3.8-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.4700", cached_price="0.0160", cache_write_price="0.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Qwen3.8 Max (0902)", "qwen/qwen3.8-max-0902", caps={**VISION_CAPS, "video_input": True}, input_price="2.0000", output_price="6.0000", cached_price="0.2500", cache_write_price="2.5000", context=1000000),
                m("Qwen3.8 Max Prime", "qwen/qwen3.8-max-prime", caps={**VISION_CAPS, "video_input": True}, input_price="4.0000", output_price="12.0000", cached_price="0.5000", context=1000000),
                m("Qwen3.8 Omni Flash", "qwen/qwen3.8-omni-flash", caps={**VISION_CAPS, "video_input": True, "audio_input": True}, input_price="0.1500", output_price="0.4700", cached_price="0.0160", context=1000000),
                # --- rekaai ---
                m("Reka Edge", "rekaai/reka-edge", caps={**VISION_CAPS, "video_input": True}, input_price="0.1000", output_price="0.1000", context=16384),
                # --- sakana ---
                m("Sakana Fugu Max", "sakana/fugu-max", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="6.0000", cached_price="0.2500", context=1000000),
                m("Sakana Fugu Ultra", "sakana/fugu-ultra", caps=VISION_CAPS, input_price="5.0000", output_price="30.0000", cached_price="0.5000", context=1000000),
                m("Sakana Fugu Ultra v2", "sakana/fugu-ultra-v2", caps={**VISION_CAPS, "document_input": True}, input_price="5.0000", output_price="30.0000", cached_price="0.5000", context=1000000),
                m("Sakana Namazu", "sakana/sakana-namazu", caps={**VISION_CAPS, "document_input": True}, input_price="0.9500", output_price="4.0000", cached_price="0.1500", context=262144),
                # --- stepfun ---
                m("StepFun Step 3.7 Flash", "stepfun/step-3.7-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.2000", output_price="1.1500", cached_price="0.0400", context=262144),
                # --- unbiased ---
                m("Pareto", "unbiased/pareto", caps=VISION_CAPS, input_price="2.5000", output_price="7.5000", cached_price="0.2500", context=262144),
                # --- x-ai (4.7 current; older numbered gens retire below) ---
                m("SpaceXAI Grok 4.7", "x-ai/grok-4.7", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="6.0000", cached_price="0.5000", context=500000, effort=EFFORT_STANDARD),
                m("SpaceXAI Grok Build 0.1", "x-ai/grok-build-0.1", caps={**VISION_CAPS, "document_input": True}, input_price="1.0000", output_price="2.0000", cached_price="0.2000", context=256000),
                # --- xiaomi (V2.6 current; V2.5 retired below) ---
                m("Xiaomi MiMo-V2.6-Flash", "xiaomi/mimo-v2.6-flash", caps={**VISION_CAPS, "video_input": True, "audio_input": True}, input_price="0.1400", output_price="0.2800", cached_price="0.0028", context=1050000),
                m("Xiaomi MiMo-V2.6-Pro", "xiaomi/mimo-v2.6-pro", caps={**VISION_CAPS, "video_input": True, "audio_input": True}, input_price="0.4350", output_price="0.8700", cached_price="0.0036", context=1050000),
                m("Xiaomi MiMo-V2.6-Pro-UltraSpeed", "xiaomi/mimo-v2.6-pro-ultraspeed", caps={**VISION_CAPS, "video_input": True, "audio_input": True}, input_price="4.3500", output_price="8.7000", cached_price="0.0360", context=1048576, description="The MiMo V2.6 Pro checkpoint on a fast serving tier - about 10x the speed by Xiaomi own figure, at 10x the price."),
                # --- z-ai (5.x current; 4.x vision retired below) ---
                m("Z.ai GLM 5.3 Flash", "z-ai/glm-5.3-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.5000", cached_price="0.0300", context=1048576, effort=EFFORT_TOGGLEABLE),
                m("Z.ai GLM 5.3 FlashX", "z-ai/glm-5.3-flashx", caps={**VISION_CAPS, "video_input": True}, input_price="0.3700", output_price="1.2500", cached_price="0.0900", context=1048576),
                m("Z.ai GLM 5V Turbo", "z-ai/glm-5v-turbo", caps={**VISION_CAPS, "video_input": True}, input_price="1.2000", output_price="4.0000", cached_price="0.2400", context=202752),
                # --- Platform plumbing: not offered in the picker ---
                # `OpenRouterNode.default_model` and its 404-retry
                # `FALLBACK_MODEL` name this id. It is text-only, so
                # `llm/views.py::offered_in_picker` keeps it out of the picker;
                # the row stays so its price and window are still known.
                m("NVIDIA Nemotron 3 Super 120B Free", "nvidia/nemotron-3-super-120b-a12b:free", True, CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
            ],
        },
        {
            "name": "NVIDIA NIM",
            "slug": "nvidia",
            "description": "NVIDIA NIM API — optimized inference for NVIDIA and open-source models.",
            "icon": "NV",
            "models": [
                # --- Platform plumbing: text-only, not offered in the picker ---
                # Lightning is the context-fold model (`CONTEXT_SUMMARY_MODEL`)
                # and the guest chat model; Super is `NvidiaNode.default_model`.
                # Both must keep an active row — a retired one is substituted
                # by `llm/fallback.py` — and both are text-only, so the picker
                # leaves them out (`llm/views.py::offered_in_picker`).
                m("Nemotron 3.5 Lightning 30B", "nvidia/nemotron-3.5-lightning-30b-a3b", caps=CHAT_CAPS, input_price="0.1000", output_price="0.3000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Nemotron 3 Super 120B", "nvidia/nemotron-3-super-120b-a12b", caps=CHAT_CAPS, input_price="0.3000", output_price="1.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Vision: the witness chain in chat/vision/resolve.py ---
                # Re-tested 2026-10-01 with the production key, a rendered
                # number and a tool definition. Llama 3.2 11B Vision read it in
                # 0.5 s but answers 400 when tools are sent with an image, so
                # it claims image input only. Nano Omni read it and called the
                # tool in ~5 s (it also returns 503 when its workers are full,
                # which is why it is the fallback and not the first choice).
                # Llama 3.2 90B Vision timed out at 90 s four times running and
                # retires below.
                m("Llama 3.2 11B Vision", "meta/llama-3.2-11b-vision-instruct", caps={"image_input": True}, input_price="0.0600", output_price="0.0600", context=128000),
                m("Nemotron 3 Nano Omni 30B", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", caps=VISION_CAPS, input_price="0.1000", output_price="0.3000", context=128000, effort=EFFORT_TOGGLEABLE),
                m("Nemotron Parse", "nvidia/nemotron-parse", caps={"image_input": True, "text_input": False, "structured_output": True}, input_price="0.0500", output_price="0.0500", context=128000),
                # Embeddings — RAG pipeline model. 2048-dim; inference/engine.py
                # pins EMBEDDING_DIM to match, and EMBEDDER_VERSION carries the
                # pair so a swap re-indexes instead of mixing two vector spaces.
                m("Nemotron 3 Embed 1B", "nvidia/nemotron-3-embed-1b", caps={"embedding_generation": True}, input_price="0.0200", output_price="0.0000", context=8192),
            ],
        },
        {
            # No rows on purpose. Which models a ChatGPT plan includes is a
            # fact about the signed-in account, so `llm/chatgpt_plan.py`
            # fetches the list with the user's own token and stores it as
            # `chatgpt/<slug>` rows with `source='hand'`, which the prune
            # below leaves alone. This block only makes the provider exist,
            # so the picker can offer Continue with ChatGPT before sign-in.
            "name": "ChatGPT plan",
            "slug": "chatgpt",
            "description": "Your ChatGPT subscription (Continue with ChatGPT).",
            "icon": "GPT",
            "models": [],
        },
        {
            "name": "OpenAI",
            "slug": "openai",
            "description": "Direct connection to the OpenAI API.",
            "icon": "OA",
            "models": [
                # Direct-API twins of the OpenRouter rows, for a user holding
                # only an OpenAI key. Ids, prices and modalities checked
                # 2026-10-01 against models.dev's `openai` listing. The `-pro`
                # ids are gone from here: Pro is a request mode
                # (`reasoning.mode`) on the direct API, not a model id, and no
                # listing carries one, so those rows were offering ids that
                # cannot be called. Astra stays on this provider as its
                # strongest model, although on OpenRouter Opus 5.5 beats it at
                # under half the price.
                m("GPT-6.1 Sol", "gpt-6.1-sol", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Luna", "gpt-6-luna", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Astra", "gpt-6-astra", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000, effort=EFFORT_STANDARD),
                # Specialised modalities (pricing is per image, not per token;
                # 0 here). Sora 2 Pro is gone: OpenAI switched the Sora API off
                # on 2026-09-24 with no replacement. GPT Realtime 1.5 is gone
                # too — it is a websocket model this platform never called.
                m("GPT Image 2.5 Sunburst", "gpt-image-2.5-sunburst", caps={"image_input": True, "image_generation": True}, input_price="0.0000", output_price="0.0000", context=0),
                m("GPT Image 2.5 Flare", "gpt-image-2.5-flare", caps={"image_input": True, "image_generation": True}, input_price="0.0000", output_price="0.0000", context=0),
                m("Text Embedding 3 Large", "text-embedding-3-large", caps={"embedding_generation": True}, input_price="0.1300", output_price="0.0000", context=8191),
            ],
        },
        {
            "name": "Ollama (Local)",
            "slug": "ollama",
            "description": "Run private local AI models on your own hardware.",
            "icon": "OL",
            "models": [
                # Local models are $0 — no meter. Re-curated 2026-10-01 against
                # ollama.com's vision listing: every row reads images and calls
                # tools. DeepSeek R1 (8B, 32B) and Qwen 3 8B are text-only and
                # retire below; Llama 4 Scout does read images but is 18 months
                # old and scores 8 on the AA index.
                m("Qwen 3.8 27B", "qwen3.8:27b", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
                m("Qwen 3.6", "qwen3.6:latest", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
                m("Qwen 3.5 9B", "qwen3.5:9b", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
            ],
        },
    ]

    providers = deepcopy(providers)
    _assert_unique_values(providers)

    print("\n" + "=" * 80)
    print("Synchronizing AI Models Database...")
    print("=" * 80 + "\n")

    synced_model_values = []

    with transaction.atomic():
        for provider_data in providers:
            model_data = provider_data.pop("models")

            provider, _ = AIProvider.objects.update_or_create(
                slug=provider_data["slug"],
                defaults=provider_data,
            )

            print(f"Provider: {provider.name}")

            for item in model_data:
                item["provider"] = provider
                defaults = build_model_defaults(item)

                AIModel.objects.update_or_create(
                    value=item["value"],
                    defaults=defaults,
                )

                synced_model_values.append(item["value"])
                badge = "free" if item["is_free"] else "paid"
                print(f"   - [{badge}] {item['name']}  ${item['input_price_per_million']}/${item['output_price_per_million']}  ctx {item['context_window']}")

            print("   Done.\n")

        # Providers dropped from the supported set. Deactivated rather than
        # deleted for the same reason as the models below: a saved workflow may
        # still point at one, and their models remain reachable through the
        # OpenRouter block above under `anthropic/…`, `google/…`, `x-ai/…`.
        stale = AIProvider.objects.filter(is_active=True).exclude(
            slug__in=SUPPORTED_PROVIDERS)
        if stale.exists():
            print("Deactivating providers no longer supported:")
            for name in sorted(stale.values_list("name", flat=True)):
                print(f"   - {name}")
            AIModel.objects.filter(provider__in=stale).update(is_active=False)
            stale.update(is_active=False)
            print()

        # Keep manually-added and older rows. This seed script only upserts.
        # Rows deliberately retired (`retired_at` set — by a refresh holding
        # live evidence, or by the force list below) are NOT resurrected here:
        # without this guard every backend boot would undo the refresh. A row
        # that is genuinely back upstream is re-listed by the refresh itself
        # on sight, or by staff in admin.
        AIModel.objects.filter(
            value__in=synced_model_values, retired_at__isnull=True,
        ).update(is_active=True)

        # ...except ids confirmed dead against the providers' live /models
        # endpoints. Retiring only this explicit list, rather than everything
        # absent from the catalogue above, so hand-added rows survive. They are
        # deactivated rather than deleted: a saved workflow may still reference
        # one, and a disabled row explains itself better than a missing one.
        retired = AIModel.objects.filter(value__in=RETIRED_MODEL_VALUES, is_active=True)
        if retired.exists():
            print("Retiring models that no longer exist upstream:")
            for value in sorted(retired.values_list("value", flat=True)):
                print(f"   - {value}")
            retired.update(is_active=False, retired_at=timezone.now())
            print()

        # Prune Gemma and weaker irrelevant older models (2026-09-02)
        # Any active model not in the curated synced list is stale.
        # This removes Gemma family and $0 placeholder older models (qwen3-14b, gemini-2.5, gpt-5.2 etc.)
        # not cost-efficient / fast / intelligent vs current Qwen3.8/DeepSeek/NVIDIA wave.
        #
        # Only `curated` rows: `live` rows belong to the catalogue refresh
        # (`llm/catalog_refresh.py`) and `hand` rows to whoever added them in
        # admin. Pruning those here would undo a refresh (or a person) on
        # every backend boot, since this seed runs at every boot.
        stale = AIModel.objects.filter(is_active=True, source='curated').exclude(value__in=synced_model_values)
        if stale.exists():
            print(f"Pruning {stale.count()} stale/weak models not in curated list (Gemma + older):")
            for v in sorted(stale.values_list("value", flat=True)):
                print(f"   - {v}")
            stale.update(is_active=False)
            print()

    print("=" * 80)
    print("Successfully synchronized seeded models.")
    print("=" * 80)
    print("\nPricing is USD per 1M tokens. Use llm.pricing.estimate_cost_usd(")
    print("  input_tokens, output_tokens, input_price, output_price) to bill.")
    print("  Ollama local models are $0. Free cloud models are $0 on this meter.")


if __name__ == "__main__":
    populate()
