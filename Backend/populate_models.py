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
    # Coverage target: every user can pick along three axes without duplicates:
    #   speed — Haiku 4.5 / GPT-6 Luna / V4.1 Flash / Qwen3.7 Flash / Scout (fastest)
    #           vs Sonnet 5.5 / Qwen3.7 Plus / Gemini 3.8 Flash (balanced)
    #           vs Fable 5.1 / GPT-6 Sol / Qwen3.8 Max Prime / Grok 4.7 (frontier)
    #   intelligence — Fable 5.1 / GPT-6 Sol / Opus 5.5 at top, Sonnet/Terra mid,
    #                   Haiku/Luna low
    #   cost — $0 (Free Router, Space Bunny Alpha) → $0.021/$0.32 (V4 Flash 0731)
    #          → $0.03/$0.13 (Qwen3.7 Flash) → $10/$50 (Fable 5.1)
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
                m("Auto Router", "openrouter/auto", caps=CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=0, effort=EFFORT_STANDARD),
                m("Free Models Router", "openrouter/free", True, CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=0, effort=EFFORT_STANDARD),
                m("Pareto Code Router", "openrouter/pareto-code", caps=CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=0, effort=EFFORT_STANDARD),
                # --- Sep 2026 (sixth wave): Space Bunny Alpha ---
                # Anonymous ("stealth") frontier-adjacent model, verified live
                # 2026-09-28 against OpenRouter /v1/models: $0/$0, 1M ctx,
                # text+image+video -> text, tools + reasoning + structured
                # output + `reasoning_effort`, and described upstream as
                # fast with strong coding.
                #
                # It earns a row for one reason the `openrouter/free` router
                # cannot: a router is $0 but promises nothing — you get
                # whichever free model happens to be up, at whatever context it
                # happens to have. This row is a *named* model, so an agent
                # pinned to it keeps a 1M window and multimodal input, which is
                # the property a long run and a vision witness both need. So it
                # is the only free row here that is not also a lottery.
                #
                # Treat it as a lab experiment rather than a dependency: the id
                # is `stealth/` and the weights are deliberately unattributed,
                # so the model behind it can change under the same id. Nothing
                # load-bearing should be pinned to it — the default is still
                # `openrouter/free` and the evaluator is still Muse Spark, for
                # the same reason.
                m("Space Bunny Alpha", "stealth/space-bunny-alpha", True, MULTIMODAL_CAPS,
                  input_price="0.0000", output_price="0.0000", context=1000000, effort=EFFORT_TOGGLEABLE,
                  description="Free, anonymous, 1M context, multimodal, tool-calling. Strong coding and fast — but the weights are deliberately unattributed, so the model behind this id can change without notice. Good for trying things; don't pin a production run to it."),
                # --- OpenAI via OpenRouter (GPT-6 Astra/Sol/Luna > GPT-5.6 tiers: Terra > Luna) ---
                # GPT-6 Astra (GA 2026-09-03, verified 2026-09-12 against OpenRouter
                # /v1/models live: ctx 1050000, $10/$50 cached $1 write $12.50).
                # Direct OpenAI docs add: 128K max out, Apr 30 2026 cutoff,
                # reasoning.effort low..max (no none/minimal rung on this model,
                # so EFFORT_STANDARD — xhigh/max snap to high via nearest()).
                # Requests >272K input tokens bill 2x in / 1.5x out; stored base.
                m("OpenAI GPT-6 Astra", "openai/gpt-6-astra", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000, effort=EFFORT_STANDARD),
                # --- Sep 2026: GPT-6 Astra Pro (verified 2026-09-12 against OpenRouter
                # /v1/models live: ctx 1050000, same $10/$50 cached $1 write $12.50).
                # Same checkpoint as Astra, served with reasoning.mode=pro — a mode,
                # not an effort rung, so same EFFORT_STANDARD and no UI distinction
                # beyond the row itself.
                m("OpenAI GPT-6 Astra Pro", "openai/gpt-6-astra-pro", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000, effort=EFFORT_STANDARD),
                # Pricing post Jul 30 cuts, verified live 2026-09-23 against
                # OpenRouter /v1/models: Terra $2/$12 cached $0.20, Luna
                # $0.20/$1.20 cached $0.02. (Sol removed — GPT-6 Sol holds the
                # $2/$10 tier at the same price, newer generation.)
                #
                # Sep 2026 (sixth wave): the whole 5.6 line retires. GPT-6
                # Luna is $0.10/$0.50 against 5.6 Luna's $0.20/$1.20 at the
                # same 1.05M ctx, and GPT-6 Sol is $2/$10 against 5.6 Terra's
                # $2/$12 — so every 5.6 tier is strictly dominated on price at
                # equal-or-better context, with no capability of its own. That
                # takes `EFFORT_WITH_MINIMAL` out of the seed with it: those
                # tiers were the only rows serving a rung below `low`, and the
                # GPT-6 family does not. Silently claiming otherwise would put
                # `reasoning_effort: minimal` on the wire for a model that
                # answers 400.
                # --- Anthropic via OpenRouter (Opus 5.5 > Fable 5.1 > Sonnet 5.5 > Haiku 4.5) ---
                # Opus 5.5 $4/$20 cache-read $0.20 write $5/$8, Sonnet $2/$10 cache $0.20, Haiku $1/$5 cache $0.10
                # Context: 1M (Haiku 200K) per platform.claude.com
                #
                # --- Sep 2026: Claude Sonnet 5.5 (released 2026-09-28, verified
                # the same day against OpenRouter /v1/models live: 1M ctx,
                # $2/$10 cached $0.20 write $2.50, text+image+file -> text) ---
                # Same $2/$10 and the same 1M window as Sonnet 5, and it is the
                # newer half of Anthropic's 5.5 family (Opus 5.5 shipped
                # 2026-09-22). Sonnet 5 retires below: identical money, older
                # checkpoint, nothing it does that 5.5 does not.
                m("Anthropic Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", cached_price="0.2000", cache_write_price="2.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Anthropic Claude Haiku 4.5", "anthropic/claude-haiku-4.5", caps=VISION_CAPS, input_price="1.0000", output_price="5.0000", cached_price="0.1000", context=200000, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Claude Fable 5.1 (GA 2026-09-01, verified 2026-09-12
                # against OpenRouter /v1/models live: ctx 1M, $10/$50) ---
                # Latest Fable available — kept. Base Fable 5 retired 2026-09-23
                # (Anthropic moved it to legacy at the same rate).
                # Text+image+file in, 128K out, adaptive reasoning.
                m("Anthropic Claude Fable 5.1", "anthropic/claude-fable-5.1", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="0.2500", cache_write_price="12.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Claude Opus 5.5 (GA 2026-09-22, verified 2026-09-23
                # against OpenRouter /v1/models live: ctx 1M, $4/$20) ---
                # Fable-5.1-level results at ~40% under Opus 5's rates; Jun 2026
                # cutoff. Default effort is medium (documented — the vendor's
                # default, not ours — so it is stored rather than left blank).
                m("Anthropic Claude Opus 5.5", "anthropic/claude-opus-5.5", caps={**VISION_CAPS, "document_input": True}, input_price="4.0000", output_price="20.0000", cached_price="0.2000", cache_write_price="5.0000", context=1000000, effort=EFFORT_TOGGLEABLE, default_effort="medium"),
                # --- Google via OpenRouter ---
                # 3.7 Flash retired 2026-09-23 (same $0.75/$3.75 as 3.8, older).
                # --- Sep 2026: Gemini 3.8 Flash (GA 2026-09-02, verified 2026-09-12
                # against OpenRouter /v1/models live: ctx 1048576) ---
                # Intro pricing $0.75/$3.75 cached $0.075 through 2026-12-31, then
                # $1.50/$7.50 — stored rate goes stale Jan 2027, revisit then.
                # Thinking levels LOW/MEDIUM/HIGH (default MEDIUM); MINIMAL is a
                # native-API validation error, so EFFORT_STANDARD, not TOGGLEABLE.
                m("Google Gemini 3.8 Flash", "google/gemini-3.8-flash", caps=MULTIMODAL_CAPS, input_price="0.7500", output_price="3.7500", cached_price="0.0750", context=1048576, effort=EFFORT_STANDARD),
                # --- DeepSeek via OpenRouter (MIT open-weights) ---
                # Old V4 Pro/Flash rows retired 2026-09-23 (superseded by 0731 +
                # V4.1 Flash); the current DeepSeek rows live in the Sep 2026
                # open-source wave block below.
                # --- xAI via OpenRouter ---
                # --- Sep 2026: Grok 4.7 (released 2026-09-21, verified 2026-09-28
                # against OpenRouter /v1/models live: 500K ctx, $1.60/$4.80
                # cached $0.40, text+image+file -> text) ---
                # Cheaper *and* newer than 4.6 ($2/$6 cached $0.50) at the same
                # 500K window, and better on the benchmarks that matter for a
                # tool loop: +2 on the Artificial Analysis Intelligence Index,
                # +111 Elo on AA-Briefcase (long-horizon agentic knowledge work),
                # and 46.3% on CursorBench 4.0 against 4.6's 40.4% — which puts
                # it ahead of GPT-6 Sol (41.7%) on coding autonomy. 4.6 retires
                # below; there is no tier it still wins.
                # EFFORT_STANDARD, matching 4.6: xAI documents low/high/xhigh
                # here but no way to switch thinking off.
                m("xAI Grok 4.7", "x-ai/grok-4.7", caps={**VISION_CAPS, "document_input": True}, input_price="1.6000", output_price="4.8000", cached_price="0.4000", context=500000, effort=EFFORT_STANDARD),
                # --- Meta via OpenRouter ---
                # Scout keeps the budget-long-ctx slot ($0.10, 1.31M); Maverick
                # retired 2026-09-23 (middle child — Qwen3.8 Flash beats it at
                # $0.15/$0.47 with a newer cutoff).
                m("Meta Llama 4 Scout", "meta-llama/llama-4-scout", caps=VISION_CAPS, input_price="0.1000", output_price="0.3000", context=1310720),
                # --- Qwen via OpenRouter ---
                # Qwen3.8 Max $2/$6 1M cached $0.25, Qwen3.8 27B $0.35/$2.75 cached $0.035, Qwen3.7 Flash $0.03/$0.13 ultra-cheap
                # Qwen3.8 Max 0902: updated snapshot of Qwen3.8 Max (2.4T MoE),
                # $2/$6 cached $0.25 write $2.50, 1M ctx, text+image+video->text
                # (verified 2026-09-12 against OpenRouter /v1/models live). The
                # un-dated `qwen/qwen3.8-max` id is gone from OR (404) and the
                # weights-named `2.4t-a95b` id is the same tier older — both
                # retire below; one row per tier.
                m("Qwen3.8 Max 0902", "qwen/qwen3.8-max-0902", caps={**VISION_CAPS, "video_input": True}, input_price="2.0000", output_price="6.0000", cached_price="0.2500", cache_write_price="2.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Qwen3.8 27B", "qwen/qwen3.8-27b", caps={**VISION_CAPS, "video_input": True}, input_price="0.4200", output_price="3.0000", cached_price="0.0850", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Qwen3.7 Flash", "qwen/qwen3.7-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.0300", output_price="0.1300", cached_price="0.0060", cache_write_price="0.0380", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Qwen3.7 Plus (verified 2026-09-28 against
                # OpenRouter /v1/models live: 1M ctx, $0.32/$1.28 cached $0.064
                # write $0.40, text+image -> text) ---
                # The mid tier the catalogue was missing. Everything cheap was
                # under $0.20 and everything capable started at $2, so a run
                # that wanted 1M ctx, vision and reasoning had to pay frontier
                # money for it. BenchLM's September tool-use leaderboard puts
                # 3.7 Plus first at 72 — the single most load-bearing number
                # for a platform whose product *is* a tool loop.
                m("Qwen3.7 Plus", "qwen/qwen3.7-plus", caps=VISION_CAPS, input_price="0.3200", output_price="1.2800", cached_price="0.0640", cache_write_price="0.4000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Mistral via OpenRouter ---
                # Retired 2026-09-23: Small 2603 ($0.15/$0.60 live, 262K) loses
                # on price, ctx and cutoff to Qwen3.7 Flash ($0.03/$0.13, 1M).
                # No Mistral row until one competes again.
                # --- Google Open via OpenRouter ---
                # --- NVIDIA via OpenRouter (the :free suffix is OpenRouter-only) ---
                # No OpenRouter row for Nemotron 3 Ultra, and that is not an
                # oversight: the id `nvidia/nemotron-3-ultra-550b-a55b` is the
                # NIM row's id too, and `AIModel.value` is globally unique. Two
                # seed entries under that value meant the second one silently
                # re-pointed the row's provider FK, so the OpenRouter Ultra was
                # never in the catalogue at all. The NIM row is the one worth
                # keeping (a platform key can pay for it), so the collision is
                # resolved by dropping the OpenRouter line and
                # `_assert_unique_values` below now fails the seed if anyone
                # reintroduces one. To offer Ultra through OpenRouter, mint a
                # distinct value — do not reuse the NIM id.
                m("NVIDIA Nemotron 3 Super 120B Free", "nvidia/nemotron-3-super-120b-a12b:free", True, CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Upstage Solar Mini 4 (verified 2026-09-28 against
                # OpenRouter /v1/models live: 524K ctx, $0.05/$0.20 cached
                # $0.005, text -> text) ---
                # The cheapest row here with real output volume behind it
                # ($0.20 vs Qwen3.7 Flash's $0.13 on a third of the context),
                # and the only seeded row that declares `parallel_tool_calls` —
                # which is the capability `tools_node`'s `asyncio.gather` pass
                # actually depends on. Upstage builds Document AI, so it is also
                # the vendor whose model has seen the most PDFs, which is this
                # platform's second-largest input type after chat.
                m("Upstage Solar Mini 4", "upstage/solar-mini4", caps=REASONING_CAPS, input_price="0.0500", output_price="0.2000", cached_price="0.0050", context=524288, effort=EFFORT_TOGGLEABLE),
                # --- Notable independents ---
                m("Moonshot Kimi K3", "moonshotai/kimi-k3", caps=VISION_CAPS, input_price="3.0000", output_price="15.0000", cached_price="0.3000", context=1048576, effort=EFFORT_STANDARD),
                # --- Aug 2026 additions (verified 2026-08-27) ---
                # Muse Spark 1.2 standard retired 2026-09-23 (same $1.25/$4.25
                # as 1.3, older and weaker); the 1.2-contributor billing row
                # stays for anyone pinned to that checkpoint.
                # GLM-5.3: Z.ai 2026-08-14. Re-verified 2026-09-28 against
                # OpenRouter /v1/models live: $0.1785/$2.805 cached $0.146625,
                # 1.31M ctx. The seed carried the launch price ($1.40/$4.40),
                # which was 8x the input rate we are actually billed — so every
                # agent pinned to this row was estimated at roughly eight times
                # its real cost, and a spend cap refused runs it could afford.
                m("Z.ai GLM-5.3", "z-ai/glm-5.3", caps=REASONING_CAPS, input_price="0.1785", output_price="2.8050", cached_price="0.1466", context=1310720, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Muse Spark 1.3 family (verified 2026-09-03 against OpenRouter + Meta pricing) ---
                # Standard: meta/muse-spark-1.3, $1.25/$4.25 cached $0.15, 1M ctx, text+image+video in — private, not trained on.
                # Contributor: meta/muse-spark-1.3-contributor, $0.10/$0.20 cached $0.002, same caps/ctx — ~12x cheaper
                # in exchange for Meta training on prompts/completions. Same checkpoint, distinct billing endpoint.
                m("Meta Muse Spark 1.3", "meta/muse-spark-1.3", caps=MULTIMODAL_CAPS, input_price="1.2500", output_price="4.2500", cached_price="0.1500", context=1048576),
                m("Meta Muse Spark 1.3 Contributor", "meta/muse-spark-1.3-contributor", caps=MULTIMODAL_CAPS, input_price="0.1000", output_price="0.2000", cached_price="0.0020", context=1048576),
                # 1.2-contributor retired 2026-09-23 (same billing as
                # 1.3-contributor, older checkpoint).
                # --- Sep 2026 open-source wave (updated versions, verified 2026-09-02 against OpenRouter /v1/models) ---
                # Qwen3.8 Flash: open weights Qwen/Qwen3.8-Flash-Next, $0.15/$0.47 1M ctx, image+video->text -- updated, more intelligent than 3.7 Flash ($0.03) at still-cheap price
                m("Qwen3.8 Flash", "qwen/qwen3.8-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.4700", cached_price="0.0160", cache_write_price="0.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # --- Sep 2026: Qwen3.8 Max Prime (released 2026-09-23, verified
                # 2026-09-28 against OpenRouter /v1/models live: 1M ctx,
                # $4/$12 cached $0.50, text+image+video -> text) ---
                # The strongest open-weights row we can serve, and it fills the
                # hole between Sol ($2/$10) and Opus 5.5 ($4/$20): on output it
                # is 20% under Opus 5.5 at the same input rate, and it is the
                # only frontier-capable row whose weights anyone can download.
                # Max Prime is the higher-effort serving of the Max weights (the
                # pattern the GPT Pro twins and Astra Pro follow), so
                # Max 0902 stays as the cheaper serving of the same family.
                m("Qwen3.8 Max Prime", "qwen/qwen3.8-max-prime", caps={**VISION_CAPS, "video_input": True}, input_price="4.0000", output_price="12.0000", cached_price="0.5000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # DeepSeek V4 Flash 0731: open weights deepseek-ai/DeepSeek-V4-Flash-0731.
                # Re-priced 2026-09-28 against OpenRouter /v1/models live: $0.021/$0.32
                # cached $0.016, 1.31M ctx. The seed's $0.07/$0.18 was roughly the
                # inverse of the move — input fell 3x while output nearly doubled, so
                # an agent writing long answers was estimated at half what it cost.
                m("DeepSeek V4 Flash 0731", "deepseek/deepseek-v4-flash-0731", caps=REASONING_CAPS, input_price="0.0210", output_price="0.3200", cached_price="0.0160", context=1310720, effort=EFFORT_TOGGLEABLE),
                # Vision Exp retired 2026-09-23 (experimental, beaten by V4.1).
                # --- Sep 2026: DeepSeek V4.1 Flash (official 2026-09-10, verified
                # 2026-09-12 against OpenRouter /v1/models live: ctx 1048576) ---
                # First native-multimodal DeepSeek (552B CED MoE, 8B in / 16B out
                # active), open weights (MIT) + `deepseek-flash` API identity.
                # Re-priced 2026-09-28: $0.30/$1.20 cached $0.006 (the seed
                # carried the launch rate of $0.15/$0.60, so a benchmark pinned
                # to this id was costing twice what the meter recorded). OR's
                # served modality is text+image->text, so VISION_CAPS without
                # image out, whatever the launch blogs claim about the
                # architecture. Kept as the multimodal DeepSeek row: V4 Pro
                # routes to this upstream after Sep 14 and retires below.
                m("DeepSeek V4.1 Flash", "deepseek/deepseek-v4.1-flash", caps={**VISION_CAPS, "numeric_input": True, "numeric_generation": True}, input_price="0.3000", output_price="1.2000", cached_price="0.0060", context=1048576, effort=EFFORT_TOGGLEABLE),
                # Z.ai GLM-5.3 Flash: open weights zai-org/GLM-5.3-Flash. Re-priced
                # 2026-09-28 against OpenRouter /v1/models live: $0.15/$0.50 cached
                # $0.03, 1.31M ctx (the seed carried $0.075/$0.25). Note the
                # Flash/standard gap has closed to ~1.7x from ~19x — pick by
                # capability now, not by assuming the Flash is the cheap one.
                m("Z.ai GLM-5.3 Flash", "z-ai/glm-5.3-flash", caps={**VISION_CAPS, "video_input": True}, input_price="0.1500", output_price="0.5000", cached_price="0.0300", context=1310720, effort=EFFORT_TOGGLEABLE),
                # NVIDIA Nemotron 3.5 Lightning: open weights nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16.
                # 1M ctx, not the 262K the seed carried (verified 2026-09-28) — this is
                # the platform's context-fold model, so an understated window is a
                # silently oversized prompt budget on every long run.
                m("NVIDIA Nemotron 3.5 Lightning", "nvidia/nemotron-3.5-lightning", caps=CHAT_CAPS, input_price="0.0800", output_price="0.2000", cached_price="0.0400", context=1000000, effort=EFFORT_TOGGLEABLE),
                # StepFun Step 3.7 Flash: open weights stepfun-ai/Step-3.7-Flash, 196B MoE 11B active, $0.20/$1.15 262k multimodal -- fastest cheap
                m("StepFun Step 3.7 Flash", "stepfun/step-3.7-flash", caps=MULTIMODAL_CAPS, input_price="0.2000", output_price="1.1500", cached_price="0.0400", context=262144, effort=EFFORT_STANDARD),
                # MiniMax M3: open weights minimaxAI/Minimax-M3, $0.30/$1.20 1M multimodal -- cost-efficient coding
                m("MiniMax M3", "minimax/minimax-m3", caps=MULTIMODAL_CAPS, input_price="0.3000", output_price="1.2000", cached_price="0.0600", context=1048576, effort=EFFORT_STANDARD),
                # K2.7 Code + Glimmer 30B retired 2026-09-23 (both lose to M3 at
                # the same $0.30 or cheaper with 4-8x the ctx).
                # Inception Mercury 2.5: diffusion LM GA (verified 2026-09-12 against
                # OpenRouter /v1/models live: $0.04/$0.15 cached $0.004, 260k ctx,
                # text->text). The `-preview` id is delisted from OR — retires below.
                m("Inception Mercury 2.5", "inception/mercury-2.5", caps=CHAT_CAPS, input_price="0.0400", output_price="0.1500", cached_price="0.0040", context=260000),
                # --- Sep 2026 third wave (verified 2026-09-23 against OpenRouter
                # /v1/models live — every id below returned a listing) ---
                # The GPT-5.6 Pro twins left with the rest of the 5.6 line on
                # 2026-09-28; see the GPT-6 note above for why.
                # GPT-6 family beyond Astra (OR lists Luna + Sol + both Pro
                # twins; no Terra tier exists). Luna $0.10/$0.50
                # undercuts the retired 5.6 Luna at the same 1.05M ctx — the new
                # budget default candidate. EFFORT_STANDARD like Astra.
                m("OpenAI GPT-6 Luna", "openai/gpt-6-luna", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6 Sol", "openai/gpt-6-sol", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6 Luna Pro", "openai/gpt-6-luna-pro", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", context=1050000, effort=EFFORT_STANDARD),
                m("OpenAI GPT-6 Sol Pro", "openai/gpt-6-sol-pro", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", context=1050000, effort=EFFORT_STANDARD),
                # Thinking Machines Inkling (2026-07-15, Apache 2.0, 975B/41B
                # MoE, text+image+audio->text) + Inkling Small
                # (2026-07-30, 276B/12B). The first US open-weights contender
                # from Mira Murati's lab. No effort claim: vendor-controllable
                # thinking is via Tinker, unverified on OR — silence is safe.
                # Context corrected 2026-09-28 to 524288 (the seed said 1M),
                # which is the figure OR serves, not the announced maximum.
                m("Thinking Machines Inkling", "thinkingmachines/inkling", caps={**VISION_CAPS, "audio_input": True}, input_price="1.0000", output_price="4.0500", cached_price="0.1700", context=524288),
                m("Thinking Machines Inkling Small", "thinkingmachines/inkling-small", caps={**VISION_CAPS, "audio_input": True}, input_price="0.4500", output_price="1.2000", cached_price="0.1000", context=524288),
                # Qwen3.8 Omni Flash (2026-09-18, native omni-modal
                # text+image+audio+video->text, 1M, $0.15/$0.47): the omni
                # sibling of Qwen3.8 Flash at the same price. TOGGLEABLE like
                # its sibling.
                m("Qwen3.8 Omni Flash", "qwen/qwen3.8-omni-flash", caps=MULTIMODAL_CAPS, input_price="0.1500", output_price="0.4700", cached_price="0.0160", context=1000000, effort=EFFORT_TOGGLEABLE),
                # Xiaomi MiMo V2.6 (open weights): Flash $0.14/$0.28 1M
                # (cheapest omni-capable open row) and the 1T+ Pro flagship
                # $0.435/$0.87 (undercuts K2.7 Code at the same 1M ctx). No
                # effort claim — unverified on OR.
                m("Xiaomi MiMo V2.6 Flash", "xiaomi/mimo-v2.6-flash", caps=VISION_CAPS, input_price="0.1400", output_price="0.2800", context=1048576),
                m("Xiaomi MiMo V2.6 Pro", "xiaomi/mimo-v2.6-pro", caps=VISION_CAPS, input_price="0.4350", output_price="0.8700", context=1048576),
                # --- Sep 2026 sixth wave: ByteDance Seed 2.1 Turbo (verified
                # 2026-09-28 against OpenRouter /v1/models live: 262K ctx,
                # $0.50/$2.50, text+image+video -> text) ---
                # Seed is ByteDance's production model family, and this row is
                # here for two reasons the catalogue's other mid tiers cannot
                # answer. It is the strongest **multilingual** option we serve —
                # Seed's training mix is weighted far more heavily toward
                # non-English than the Qwen/GLM/Nemotron rows, and every model
                # here is good at English and variable at the rest. And it is
                # GA rather than a preview, so unlike Ling 3.0 or the Ling VL
                # row (both passed over twice for having no usage signal) there
                # is a real deployment base behind it.
                m("ByteDance Seed 2.1 Turbo", "bytedance-seed/seed-2-1-turbo", caps=MULTIMODAL_CAPS, input_price="0.5000", output_price="2.5000", context=262144, effort=EFFORT_TOGGLEABLE),
            ],
        },
        {
            "name": "NVIDIA NIM",
            "slug": "nvidia",
            "description": "NVIDIA NIM API — optimized inference for NVIDIA and open-source models.",
            "icon": "NV",
            "models": [
                # Nemotron 3 line — ids carry no :free suffix on NIM.
                # Lightning: 30B MoE 3B active, Super: 120B 12B active, Ultra: 550B 55B active, Nano: 30B
                # Pricing via NIM is lower than OpenRouter routed; use list $0.50/$2.20 for Ultra as reference, cheaper for smaller.
                m("Nemotron 3.5 Lightning 30B", "nvidia/nemotron-3.5-lightning-30b-a3b", caps=CHAT_CAPS, input_price="0.1000", output_price="0.3000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # This row is the only place Nemotron 3 Ultra appears: its id is
                # identical to the OpenRouter one, and `AIModel.value` is globally
                # unique, so seeding both made one of them silently overwrite the
                # other's provider. NIM is the copy worth keeping — a platform
                # key can pay for it, and the OpenRouter Ultra line was never
                # reachable in the picker because of the collision. Prices here
                # are NIM's own, not OpenRouter's ($0.60/$2.40 on OR as of
                # 2026-09-28), so they are deliberately not the OR figures.
                m("Nemotron 3 Ultra 550B", "nvidia/nemotron-3-ultra-550b-a55b", caps=REASONING_CAPS, input_price="0.5000", output_price="2.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Nemotron 3 Super 120B", "nvidia/nemotron-3-super-120b-a12b", caps=CHAT_CAPS, input_price="0.3000", output_price="1.2000", context=1000000, effort=EFFORT_TOGGLEABLE),
                m("Nemotron 3 Nano 30B", "nvidia/nemotron-3-nano-30b-a3b", caps=CHAT_CAPS, input_price="0.1000", output_price="0.3000", context=1000000, effort=EFFORT_TOGGLEABLE),
                # Vision — the witness chain in chat/vision/resolve.py. Both
                # re-verified 2026-09-01 by sending a real PNG and reading the
                # rendered number back; the previous two NIM VL models are EOL.
                m("Llama 3.2 11B Vision", "meta/llama-3.2-11b-vision-instruct", caps=VISION_CAPS, input_price="0.0600", output_price="0.0600", context=128000),
                m("Nemotron 3 Nano Omni 30B", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", caps=VISION_CAPS, input_price="0.1000", output_price="0.3000", context=128000, effort=EFFORT_TOGGLEABLE),
                m("Llama 3.2 90B Vision", "meta/llama-3.2-90b-vision-instruct", caps=VISION_CAPS, input_price="0.3500", output_price="0.4000", context=128000),
                m("Nemotron Parse", "nvidia/nemotron-parse", caps={"image_input": True, "text_input": False, "structured_output": True}, input_price="0.0500", output_price="0.0500", context=128000),
                # Open-weight models hosted on NIM (pruned older gens)
                m("GPT-OSS 120B", "openai/gpt-oss-120b", caps=CHAT_CAPS, input_price="0.2000", output_price="0.8000", context=128000, effort=EFFORT_STANDARD),
                m("GPT-OSS 20B", "openai/gpt-oss-20b", caps=CHAT_CAPS, input_price="0.1000", output_price="0.3000", context=128000, effort=EFFORT_STANDARD),
                # Embeddings — RAG pipeline model. 2048-dim; inference/engine.py
                # pins EMBEDDING_DIM to match, and EMBEDDER_VERSION carries the
                # pair so a swap re-indexes instead of mixing two vector spaces.
                m("Nemotron 3 Embed 1B", "nvidia/nemotron-3-embed-1b", caps={"embedding_generation": True}, input_price="0.0200", output_price="0.0000", context=8192),
            ],
        },
        {
            "name": "OpenCode Zen",
            "slug": "opencode",
            "description": "Free models on your own OpenCode Zen account (bring your own key). Free models may be used for training.",
            "icon": "OC",
            "models": [
                # Ids verified live 2026-09-22 against keyless
                # GET https://opencode.ai/zen/v1/models (all present), then
                # checked against the endpoint table in
                # https://opencode.ai/docs/zen (2026-09-22): six of these are
                # documented `chat/completions` models; `deepseek-v4-flash-free`
                # is absent from that table but its paid sibling
                # (`deepseek-v4-flash`) is chat/completions, so it stays
                # pending the first keyed call. Deliberately NOT seeded:
                # `muse-spark-1.3-contributor-free` and
                # `muse-spark-1.2-contributor-free` (both live on /models, both
                # mapped by the docs to the `/responses` endpoint — Responses
                # API, a different protocol — which this provider does not
                # speak; offering either would be offering a model every call
                # fails on), and `jev-1.13-free` / `jev-1.13` (live, but on
                # `/systemone`, out of scope per OPENCODE_ZEN_PLAN §7).
                # NOT yet verified — needs a Zen key (see
                # docs/OPENCODE_ZEN_PLAN.md §8): chat-completions answers,
                # streaming, `tool_calls`, and `reasoning_effort` acceptance.
                # Until then: CHAT_CAPS claims tool calling because these are
                # agentic-coding models on a chat-completions endpoint (a wrong
                # claim degrades to the model ignoring tools, while a missing
                # one withholds the toolbox entirely); effort stays empty, the
                # safe default; context is 0 (the listing carries none).
                m("Big Pickle (Free)", "opencode/big-pickle", True, CHAT_CAPS,
                  description="Stealth model, free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                # Space Bunny Free: added 2026-09-28, verified the same day
                # against the endpoint table in https://opencode.ai/docs/zen,
                # which lists it on `/chat/completions` — the protocol this
                # provider speaks, unlike the `-contributor` and `jev-*` rows
                # that are mapped to `/responses` and `/systemone` and stay
                # unseeded. Also live on the keyless /v1/models listing. Same
                # caveats as Big Pickle and stronger in every dimension: Zen
                # terms permit training on these prompts, so they are for work
                # you would not mind a vendor reading.
                m("Space Bunny Free", "opencode/space-bunny-free", True, CHAT_CAPS,
                  description="Free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                m("DeepSeek V4 Flash (Free)", "opencode/deepseek-v4-flash-free", True, CHAT_CAPS,
                  description="DeepSeek V4 (not V4.1), free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                m("Mimo v2.6 Flash (Free)", "opencode/mimo-v2.6-flash-free", True, CHAT_CAPS,
                  description="Limited-time free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                m("Mimo v2.5 (Free)", "opencode/mimo-v2.5-free", True, CHAT_CAPS,
                  description="Limited-time free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                m("Ling 3.0 Flash (Free)", "opencode/ling-3.0-flash-fin-free", True, CHAT_CAPS,
                  description="Limited-time free on your OpenCode Zen account — prompts may be used for training. Avoid private data."),
                m("Nemotron 3 Ultra (Free)", "opencode/nemotron-3-ultra-free", True, CHAT_CAPS,
                  description="NVIDIA trial — do not submit personal or confidential data."),
                m("Nemotron 3.5 Lightning (Free)", "opencode/nemotron-3.5-lightning-free", True, CHAT_CAPS,
                  description="NVIDIA trial — do not submit personal or confidential data."),
            ],
        },
        {
            "name": "OpenAI",
            "slug": "openai",
            "description": "Direct connection to the OpenAI API.",
            "icon": "OA",
            "models": [
                # GPT-6 Astra (GA 2026-09-03) — direct-API twin of the OpenRouter
                # row above; same $10/$50 cached $1 write $12.50, 1.05M ctx.
                m("GPT-6 Astra", "gpt-6-astra", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Astra Pro", "gpt-6-astra-pro", caps={**VISION_CAPS, "document_input": True}, input_price="10.0000", output_price="50.0000", cached_price="1.0000", cache_write_price="12.5000", context=1050000, effort=EFFORT_STANDARD),
                # The whole GPT-5.6 line retires 2026-09-28 (four rows here, four
                # on the OpenRouter side). Every 5.6 tier is strictly dominated
                # by the GPT-6 tier above it at equal-or-better context: 5.6
                # Terra $2/$12 vs GPT-6 Sol $2/$10, 5.6 Luna $0.20/$1.20 vs
                # GPT-6 Luna $0.10/$0.50. None of them has a capability of its
                # own, so keeping them would mean offering a user two prices for
                # the same model. Direct-API twins of the OpenRouter rows above.
                m("GPT-6 Luna", "gpt-6-luna", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Sol", "gpt-6-sol", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Luna Pro", "gpt-6-luna-pro", caps={**VISION_CAPS, "document_input": True}, input_price="0.1000", output_price="0.5000", context=1050000, effort=EFFORT_STANDARD),
                m("GPT-6 Sol Pro", "gpt-6-sol-pro", caps={**VISION_CAPS, "document_input": True}, input_price="2.0000", output_price="10.0000", context=1050000, effort=EFFORT_STANDARD),
                # Specialised modalities — latest only (pricing is per image/sec, not per token; 0 here)
                # GPT Image 2 retired 2026-09-23 — superseded by the 2.5 tiers
                # (Sunburst precision / Flare speed, both verified live on
                # /images/models 2026-09-23).
                m("GPT Image 2.5 Sunburst", "gpt-image-2.5-sunburst", caps={"image_input": True, "image_generation": True}, input_price="0.0000", output_price="0.0000", context=0),
                m("GPT Image 2.5 Flare", "gpt-image-2.5-flare", caps={"image_input": True, "image_generation": True}, input_price="0.0000", output_price="0.0000", context=0),
                m("Sora 2 Pro", "sora-2-pro", caps={"video_generation": True}, input_price="0.0000", output_price="0.0000", context=0),
                m("GPT Realtime 1.5", "gpt-realtime-1.5", caps={"audio_input": True, "audio_generation": True, **CHAT_CAPS}, input_price="4.0000", output_price="16.0000", context=128000),
                m("Text Embedding 3 Large", "text-embedding-3-large", caps={"embedding_generation": True}, input_price="0.1300", output_price="0.0000", context=8191),
            ],
        },
        {
            "name": "Ollama (Local)",
            "slug": "ollama",
            "description": "Run private local AI models on your own hardware.",
            "icon": "OL",
            "models": [
                # Local models are $0 — no meter. Context is Ollama default.
                # Phi 4 + Mistral 7B retired 2026-09-23 (qwen3:8b covers the
                # small-local slot: 32K, effort control, newer cutoff).
                m("DeepSeek R1 8B", "deepseek-r1:8b", True, REASONING_CAPS, input_price="0.0000", output_price="0.0000", context=128000, effort=EFFORT_TOGGLEABLE),
                m("DeepSeek R1 32B", "deepseek-r1:32b", True, REASONING_CAPS, input_price="0.0000", output_price="0.0000", context=128000, effort=EFFORT_TOGGLEABLE),
                m("Llama 4 Scout", "llama4:scout", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=10000000),
                m("Qwen 3.6", "qwen3.6:latest", True, VISION_CAPS, input_price="0.0000", output_price="0.0000", context=262144, effort=EFFORT_TOGGLEABLE),
                m("Qwen 3 8B", "qwen3:8b", True, CHAT_CAPS, input_price="0.0000", output_price="0.0000", context=32768, effort=EFFORT_TOGGLEABLE),
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
