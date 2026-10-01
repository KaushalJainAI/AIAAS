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
    "google/gemini-3.6-flash",              # superseded by gemini-3.8-flash
    "google/gemini-3.5-flash-lite",         # superseded by gemini-3.8-flash
    "deepseek/deepseek-r1",                 # superseded by deepseek-v4.1-flash
    "x-ai/grok-4.20-multi-agent",           # superseded by grok-4.6
    "qwen/qwen3.6-plus",                    # superseded by qwen3.8-max / 27b
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
    "moonshotai/kimi-k2.6",                  # 404 — not entitled for this account
    # OpenAI direct — superseded by GPT-6 tiers
    "gpt-4o",                               # superseded by gpt-5.6-terra/sol
    "o3",                                   # superseded by o4-mini / gpt-5.6 reasoning
    # Ollama local — tiny or superseded
    "deepseek-r1:1.5b",                     # superseded by 8b/32b, too small for R1 quality
    "qwen2.5-coder:32b",                    # superseded by qwen3.6:latest,    # Pruned 2026-09-02 -- not cost-efficient / fast / intelligent, superseded by 2026-08/09 open-source wave
    "openai/gpt-4o-mini",                   # superseded by gpt-5.6-luna ($0.20/$1.20, 1.5M ctx, far smarter)
    "gpt-4o-mini",                          # openai provider duplicate of above
    "google/gemini-3.1-pro-preview",        # superseded by gemini-3.8-flash ($0.75 vs $2/12, faster)
    "deepseek/deepseek-v4-pro",             # superseded by v4.1-flash (native multimodal, 7x cheaper; vendor routes pro->flash after Sep 14)
    "deepseek/deepseek-v4-flash",           # superseded by v4-flash-0731 ($0.07 vs $0.22)
    "deepseek/deepseek-v4-pro-0813",        # superseded by v4.1-flash ($0.15 vs $1.12, native multimodal; vendor routes pro->flash after Sep 14 noon BJT)
    # Gemma family -- small, not competitive vs Qwen/DeepSeek/NVIDIA (pruned per user 2026-09-02)
    "google/gemma-4-31b-it:free",
    "google/gemma-4-31b-it",
    "gemma4:latest",
    "gemma4:4b",
    # Pruned 2026-09-12 (verified against OpenRouter /v1/models live) — dead or
    # same-tier-older ids found by diffing the live catalogue against this seed.
    "qwen/qwen3.8-max",                     # 404 on OR — replaced by max-0902 snapshot
    "qwen/qwen3.8-2.4t-a95b",               # same $2/$6 tier older, superseded by max-0902
    "inception/mercury-2.5-preview",        # delisted from OR — superseded by mercury-2.5 GA
    # Pruned 2026-09-23 (verified against OpenRouter /v1/models live
    # 2026-09-23; each loses on all four axes — price, speed, intelligence,
    # knowledge cutoff — to a row that stays).
    "meta/muse-spark-1.2",                  # same $1.25/$4.25 as 1.3, older, weaker
    "o4-mini",                              # $1.10/$4.40 200K reasoning-only vs Luna $0.20/$1.20 1.5M
    "mistralai/mistral-small-2603",         # $0.15/$0.60 262K vs Qwen3.7 Flash $0.03/$0.13 1M
    "meta-llama/llama-4-maverick",          # middle child: Scout keeps budget-long-ctx,
                                            # Qwen3.8 Flash beats it at $0.15/$0.47
    # Pruned 2026-09-23 (second cut) — GPT-6 Sol holds the $2/$10 tier now,
    # so the whole 5.6 Sol line is strictly dominated at identical price.
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-sol-pro",
    "gpt-5.6-sol",
    "gpt-5.6-sol-pro",
    # Pruned 2026-09-23 (third cut) — Opus 5.5 (GA 2026-09-22, $4/$20, Jun
    # 2026 cutoff) retires the Opus line and the base Fable. Fable 5.1 stays
    # as the latest Fable available.
    "anthropic/claude-opus-5",
    "anthropic/claude-fable-5",
    "gpt-image-2",                          # superseded by gpt-image-2.5-sunburst/flare
    # Pruned 2026-09-23 (fourth cut) — each loses on cost, speed and
    # intelligence to a row that stays, with no unique capability.
    "meta/muse-spark-1.2-contributor",      # same $0.10/$0.20 as 1.3-contributor, older checkpoint
    "deepseek/deepseek-v4-flash-vision-exp",  # $0.22/$0.66 exp, beaten by v4.1-flash $0.15/$0.60
    "google/gemini-3.7-flash",              # same $0.75/$3.75 as 3.8-flash, older, no cache tier
    "x-ai/grok-4.5",                        # same $2/$6 as 4.6, older
    "moonshotai/kimi-k2.7-code",            # $0.66/$3.40 262K vs mimo-pro $0.435/$0.87 1M
    "meta/muse-glimmer-30b",                # $0.30 131K vs minimax-m3 $0.30 1M
    "phi4:latest",                          # local: dominated by qwen3:8b (32K, effort control)
    "mistral:7b",                           # local: dominated by qwen3:8b (newer, toggleable)
    # Pruned 2026-09-28 (verified live against OpenRouter /v1/models the same
    # day). Ten rows, and every one of them is *strictly dominated*: a newer or
    # equal model in the same tier costs less, or costs the same at a better
    # cutoff, and none of them carries a capability the replacement lacks. The
    # bar is deliberately "loses on all four axes to a row that stays", because
    # a row that merely ties is still a second price for the same model in the
    # picker — which is the failure this catalogue has already had twice.
    "anthropic/claude-sonnet-5",            # Sonnet 5.5 is the same $2/$10 at the same
                                            # 1M (released 2026-09-28, one day later)
    "x-ai/grok-4.6",                        # Grok 4.7: $1.60/$4.80 vs $2/$6 at the same
                                            # 500K, and better on AA Intelligence Index,
                                            # AA-Briefcase (+111 Elo) and CursorBench 4.0
    # The GPT-5.6 line, OpenRouter and direct-API twins alike. GPT-6 Luna is
    # $0.10/$0.50 against 5.6 Luna's $0.20/$1.20, and GPT-6 Sol is $2/$10
    # against 5.6 Terra's $2/$12 — same or better context in both cases.
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-luna-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-terra-pro",
    "gpt-5.6-luna",
    "gpt-5.6-luna-pro",
    "gpt-5.6-terra",
    "gpt-5.6-terra-pro",
    # Pruned 2026-10-01 (seventh wave; every OpenRouter id verified live
    # against /v1/models the same day). Two reasons, kept apart on purpose.
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
    # Beaten on price, intelligence (AA Intelligence Index, 2026-09-30),
    # speed and release date by a row that stays:
    "openai/gpt-6-sol",                     # GPT-6.1 Sol: same $2/$10, index 51.8 vs 47.5
    "openai/gpt-6-sol-pro",
    "openai/gpt-6-astra",                   # $10/$50, index 52.7 vs Opus 5.5 at $4/$20, 57.6
    "openai/gpt-6-astra-pro",
    "anthropic/claude-fable-5.1",           # $10/$50, index 53.4 vs Opus 5.5 at $4/$20, 57.6
    "anthropic/claude-haiku-4.5",           # index 17 at $1/$5; GPT-6 Luna is 37 at $0.10/$0.50
    "qwen/qwen3.8-max-0902",                # index 45 at 39 tok/s vs Muse Spark 1.3: 48, 174 tok/s, cheaper
    "qwen/qwen3.8-max-prime",               # the same weights at twice the price
    "qwen/qwen3.8-27b",                     # index 34 at $0.42/$3 vs GLM-5.3 Flash: 42 at $0.15/$0.50
    "qwen/qwen3.7-plus",                    # index 25 at $0.32/$1.28
    "qwen/qwen3.8-omni-flash",              # a second row at the Qwen3.8 Flash price
    "moonshotai/kimi-k3",                   # index 44, 34 tok/s, $10 out vs MiMo V2.6 Pro: 46 at $0.87
    "minimax/minimax-m3",                   # index 29 vs DeepSeek V4.1 Flash: 39.5, faster, cheaper
    "stepfun/step-3.7-flash",               # $0.20/$1.15, 262K vs GLM-5.3 Flash
    "thinkingmachines/inkling",             # index 25 at $1/$4.05, no structured output
    "thinkingmachines/inkling-small",       # index 26 vs DeepSeek V4.1 Flash, which is also faster
    "bytedance-seed/seed-2-1-turbo",        # loses 3 of 4 shared benchmarks to GLM-5.3 Flash at 3x+ the price
    "meta/llama-3.2-90b-vision-instruct",   # NIM: timed out at 90 s four times running
    "llama4:scout",                         # local: 18 months old, index 8
    "opencode/mimo-v2.5-free",              # superseded by mimo-v2.6-flash-free
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
    # Jev 1.13 (Responses-protocol, out of scope per OPENCODE_ZEN_PLAN §7),
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
    # Coverage target: every user can pick along three axes without duplicates:
    #   intelligence — Opus 5.5 (57.6) / Sonnet 5.5 (56.0) / GPT-6.1 Sol (51.8)
    #                  / Muse Spark 1.3 (48.1) / Grok 4.7 (46.5)
    #   cost — $0 (Free Router, Space Bunny Alpha) -> $0.021/$0.06 (Ling VL)
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
                # Both routers take images (verified 2026-10-01 against
                # OpenRouter /v1/models live: auto is text+image+file+audio+
                # video, free is text+image), so both pass the image-input
                # rule. Pareto Code is text-only with no tool support and
                # retires below.
                m("Auto Router", "openrouter/auto", caps=MULTIMODAL_CAPS, input_price="0.0000", output_price="0.0000", context=0, effort=EFFORT_STANDARD),
                m("Free Models Router", "openrouter/free", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=0, effort=EFFORT_STANDARD),
                # --- Free, named ---
                # Space Bunny Alpha: anonymous ("stealth") model, $0/$0, 1M ctx,
                # text+image+video -> text, tools + reasoning effort (verified
                # live 2026-10-01). The one free row that is a *named* model
                # rather than a lottery, so an agent pinned to it keeps a 1M
                # window and image input. The weights are unattributed and can
                # change under the same id, so nothing load-bearing is pinned
                # to it.
                m("Space Bunny Alpha", "stealth/space-bunny-alpha", True, {**VISION_CAPS, "video_input": True},
                  input_price="0.0000", output_price="0.0000", context=1000000, effort=EFFORT_TOGGLEABLE,
                  description="Free, anonymous, 1M context, reads images and video, tool-calling. Fast with strong coding — but the weights are deliberately unattributed, so the model behind this id can change without notice. Good for trying things; don't pin a production run to it."),
                # --- OpenAI via OpenRouter ---
                # GPT-6.1 Sol (released 2026-09-29, verified live 2026-10-01:
                # 1.05M ctx, $2/$10 cached $0.10 write $2.50, text+image+file).
                # Replaces GPT-6 Sol at the same price: AA Intelligence Index
                # 51.8 against 47.5, and the cache read is half. The Pro twin is
                # the same checkpoint served with reasoning.mode=pro.
                m("OpenAI GPT-6.1 Sol", "openai/gpt-6.1-sol", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6.1 Sol Pro", "openai/gpt-6.1-sol-pro", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.1000", cache_write_price="2.5000", context=1050000, effort=EFFORT_STANDARD),
                # GPT-6 Luna: the cheap fast tier — $0.10/$0.50 cached $0.01
                # write $0.125, 1.05M ctx, ~125 tok/s, AA index 37.
                m("OpenAI GPT-6 Luna", "openai/gpt-6-luna", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6 Luna Pro", "openai/gpt-6-luna-pro", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", cached_price="0.0100", cache_write_price="0.1250", context=1050000, effort=EFFORT_STANDARD),
                # --- Anthropic via OpenRouter (Opus 5.5 > Sonnet 5.5) ---
                # Opus 5.5 (GA 2026-09-22): $4/$20 cached $0.20 write $5, 1M
                # ctx. Top of the AA Intelligence Index at 57.6. Default effort
                # is medium (the vendor's default, so it is stored).
                m("Anthropic Claude Opus 5.5", "anthropic/claude-opus-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="4.0000", output_price="20.0000", cached_price="0.2000", cache_write_price="5.0000", context=1000000, effort=EFFORT_TOGGLEABLE, default_effort="medium"),
                # Sonnet 5.5 (released 2026-09-28): $2/$10 cached $0.20 write
                # $2.50, 1M ctx, AA index 56.0.
                m("Anthropic Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.2000", cache_write_price="2.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Google via OpenRouter ---
                # Gemini 3.8 Flash (GA 2026-09-02): $0.75/$3.75 cached $0.075,
                # 1.05M ctx, text+image+file+audio+video, ~220 tok/s — the
                # fastest row above AA index 40. Intro pricing runs through
                # 2026-12-31, then $1.50/$7.50 — revisit in January 2027.
                # Thinking levels LOW/MEDIUM/HIGH; MINIMAL is a native-API
                # validation error, so EFFORT_STANDARD, not TOGGLEABLE.
                m("Google Gemini 3.8 Flash", "google/gemini-3.8-flash", caps=MULTIMODAL_CAPS, input_price="0.7500", output_price="3.7500", cached_price="0.0750", context=1048576, effort=EFFORT_STANDARD),
                # --- xAI via OpenRouter ---
                # Grok 4.7 (released 2026-09-21). Re-priced 2026-10-01 against
                # OpenRouter /v1/models live: $2/$6 cached $0.50, 500K ctx — the
                # seed carried $1.60/$4.80, which was the launch discount.
                # EFFORT_STANDARD: no way to switch thinking off.
                m("xAI Grok 4.7", "x-ai/grok-4.7", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="6.0000", cached_price="0.5000", context=500000, effort=EFFORT_STANDARD),
                # --- Meta via OpenRouter ---
                # Muse Spark 1.3 (2026-09-02): $1.25/$4.25 cached $0.15, 1.05M
                # ctx, text+image+video+file. AA index 48 at ~174 tok/s, which
                # is why Qwen3.8 Max retired below — it lost on all four axes.
                # Contributor is the same checkpoint at $0.10/$0.20 in exchange
                # for Meta training on prompts and completions; it is also the
                # eval judge (`EVAL_JUDGE_MODEL`).
                m("Meta Muse Spark 1.3", "meta/muse-spark-1.3", caps={**VISION_CAPS, "video_input": True, "document_input": True}, input_price="1.2500", output_price="4.2500", cached_price="0.1500", context=1048576),
                m("Meta Muse Spark 1.3 Contributor", "meta/muse-spark-1.3-contributor", caps={**VISION_CAPS, "video_input": True, "document_input": True}, input_price="0.1000", output_price="0.2000", cached_price="0.0020", context=1048576),
                # Llama 4 Scout: old (2025-04) and weak as a chat model, kept
                # because it is the chat `auto` reviewer (`AUTO_REVIEWER_MODEL`)
                # — non-reasoning, ~0.8 s to first token, stable verdicts.
                m("Meta Llama 4 Scout", "meta-llama/llama-4-scout", caps=VISION_CAPS, input_price="0.1000", output_price="0.3000", context=1310720),
                # --- Xiaomi via OpenRouter (open weights) ---
                # MiMo V2.6, verified live 2026-10-01: text+image+audio+video,
                # 1.05M ctx. Pro is the value pick of the whole catalogue — AA
                # index 46 at $0.435/$0.87. Flash is 38 at $0.14/$0.28.
                # UltraSpeed (2026-09-21) is the same Pro checkpoint served
                # about 10x faster by the vendor's own account, at 10x the
                # price. No effort claim: the listing carries `reasoning` but
                # not `reasoning_effort`.
                m("Xiaomi MiMo V2.6 Pro", "xiaomi/mimo-v2.6-pro", caps={**VISION_CAPS, "audio_input": True, "video_input": True}, input_price="0.4350", output_price="0.8700", cached_price="0.0036", context=1050000),
                m("Xiaomi MiMo V2.6 Flash", "xiaomi/mimo-v2.6-flash", caps={**VISION_CAPS, "audio_input": True, "video_input": True}, input_price="0.1400", output_price="0.2800", cached_price="0.0028", context=1050000),
                m("Xiaomi MiMo V2.6 Pro UltraSpeed", "xiaomi/mimo-v2.6-pro-ultraspeed", caps={**VISION_CAPS, "audio_input": True, "video_input": True}, input_price="4.3500", output_price="8.7000", cached_price="0.0360", context=1048576,
                  description="The MiMo V2.6 Pro checkpoint on a fast serving tier — about 10x the speed by Xiaomi's own figure, at 10x the price. Pick it when the wait matters more than the bill."),
                # --- DeepSeek via OpenRouter (MIT open weights) ---
                # V4.1 Flash (2026-09-10): first native-multimodal DeepSeek,
                # text+image, 1.05M ctx, ~209 tok/s with ~1 s to first token,
                # AA index 39.5. It is also what the benchmark agents run on
                # (`eval/benchmarks/agents.py::BENCHMARK_MODEL`).
                # Re-priced 2026-10-01 against OpenRouter /v1/models live:
                # $0.0155/$0.396 cached $0.0029. That figure is the cheapest of
                # 32 serving endpoints (the median is $0.21/$0.80), and it is
                # what the weekly refresh writes, so the seed carries the same
                # number rather than fight it. Real spend is taken from
                # OpenRouter's own `usage.cost` wherever it is reported.
                m("DeepSeek V4.1 Flash", "deepseek/deepseek-v4.1-flash", caps={**VISION_CAPS, "numeric_input": True, "numeric_generation": True}, input_price="0.0155", output_price="0.3960", cached_price="0.0029", context=1048576, effort=EFFORT_TOGGLEABLE),
                # --- Z.ai via OpenRouter (open weights) ---
                # GLM-5.3 Flash: $0.15/$0.50 cached $0.03, 1.05M ctx (the seed
                # said 1.31M), text+image+video, AA index 41.8.
                m("Z.ai GLM-5.3 Flash", "z-ai/glm-5.3-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.5000", cached_price="0.0300", context=1048576, effort=EFFORT_TOGGLEABLE),
                # --- Qwen via OpenRouter ---
                # Qwen3.8 Flash: $0.15/$0.47, 1M ctx, text+image+video, AA
                # index 39.8. Qwen3.7 Flash is the ultra-cheap long-context row
                # at $0.03/$0.13 with the same 1M window.
                m("Qwen3.8 Flash", "qwen/qwen3.8-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.4700", cached_price="0.0160", cache_write_price="0.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Qwen3.7 Flash", "qwen/qwen3.7-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.0300", output_price="0.1300", cached_price="0.0060", cache_write_price="0.0380", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- InclusionAI via OpenRouter (open weights) ---
                # Ling 3.0 Flash VL (2026-09-10, verified live 2026-10-01):
                # $0.021/$0.0616 cached $0.0042, 262K ctx, text+image+video,
                # tools + structured output. The cheapest image-reading row
                # here, and quick: ~142 tok/s, AA index 25. Earlier passes left
                # Ling out for having no usage signal; it is on the Artificial
                # Analysis board now. No effort claim (`reasoning` only).
                m("Ling 3.0 Flash VL", "inclusionai/ling-3.0-flash-vl", caps={**VISION_CAPS, "video_input": True}, input_price="0.0210", output_price="0.0616", cached_price="0.0042", context=262144),
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
            "name": "OpenCode Zen",
            "slug": "opencode",
            "description": "Free models on your own OpenCode Zen account (bring your own key).",
            "icon": "OC",
            "models": [
                # Re-curated 2026-10-01. Ids are live on the keyless
                # GET https://opencode.ai/zen/v1/models, all three are on
                # `/chat/completions` in the endpoint table at
                # https://opencode.ai/docs/zen (the protocol this provider
                # speaks), and the input modalities and context windows are
                # from models.dev, the registry OpenCode itself maintains.
                # Only rows that read images are kept: Big Pickle, DeepSeek V4
                # Flash, Ling 3.0 Flash Fin and the two Nemotron trials are
                # text-only and retire below, and MiMo v2.5 is superseded by
                # v2.6. Still unverified without a Zen key
                # (docs/OPENCODE_ZEN_PLAN.md §8): streaming, `tool_calls` and
                # `reasoning_effort` acceptance, so effort stays empty.
                m("Space Bunny Free", "opencode/space-bunny-free", True, {**VISION_CAPS, "video_input": True}, context=1048576,
                  description="Free on your OpenCode Zen account. Reads images and video; zero-retention per the Zen docs."),
                m("LongCat 2.5 Preview (Free)", "opencode/longcat-2.5-preview-free", True, VISION_CAPS, context=1000000,
                  description="Free preview on your OpenCode Zen account. Reads images; zero-retention per the Zen docs."),
                m("Mimo v2.6 Flash (Free)", "opencode/mimo-v2.6-flash-free", True, {**VISION_CAPS, "audio_input": True, "video_input": True}, context=200000,
                  description="Limited-time free on your OpenCode Zen account — prompts may be used to improve the model. Avoid private data."),
            ],
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
