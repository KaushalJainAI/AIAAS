"""Re-list the rows the eighth wave (2026-10-08) brought back.

The seed script deliberately never resurrects a row carrying `retired_at` —
without that guard every boot would undo the catalogue refresh and every
staff edit in admin. But the eighth wave re-listed 41 live rows earlier
waves had pruned, so every database that ran those prunes holds them as
`is_active=False, retired_at=<then>`, and the seed alone leaves them off:
the deploy would ship the code for the full catalogue without the catalogue.

This one-off migration clears exactly those 41 (re-activating them and
dropping the retirement stamp) so `manage.py boot`'s migrate step heals the
server on deploy. Anything retired for another reason is untouched, and the
reverse re-retires the same 41.
"""

from django.db import migrations
from django.utils import timezone


# The 41 values earlier waves pruned that 2026-10-08 re-seeded as live
# (image input + tool calling + structured output, verified against
# OpenRouter /v1/models live the same day).
RELISTED_VALUES = [
    "anthropic/claude-fable-5",
    "anthropic/claude-fable-5.1",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
    "bytedance-seed/seed-2-1-turbo",
    "deepseek/deepseek-v4-flash-vision-exp",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.6-flash",
    "google/gemini-3.7-flash",
    "google/gemma-4-31b-it",
    "meta-llama/llama-4-maverick",
    "meta/muse-glimmer-30b",
    "meta/muse-spark-1.2",
    "meta/muse-spark-1.2-contributor",
    "minimax/minimax-m3",
    "mistralai/mistral-small-2603",
    "moonshotai/kimi-k2.6",
    "moonshotai/kimi-k2.7-code",
    "moonshotai/kimi-k3",
    "openai/gpt-4o-mini",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-luna-pro",
    "openai/gpt-5.6-sol",
    "openai/gpt-5.6-sol-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-5.6-terra-pro",
    "openai/gpt-6-astra",
    "openai/gpt-6-astra-pro",
    "openai/gpt-6-sol",
    "openai/gpt-6-sol-pro",
    "qwen/qwen3.6-plus",
    "qwen/qwen3.7-plus",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.8-max-0902",
    "qwen/qwen3.8-max-prime",
    "qwen/qwen3.8-omni-flash",
    "stepfun/step-3.7-flash",
    "x-ai/grok-4.5",
    "x-ai/grok-4.6",
]


def relist(apps, schema_editor):
    AIModel = apps.get_model("llm", "AIModel")
    AIModel.objects.filter(value__in=RELISTED_VALUES).update(
        is_active=True, retired_at=None)


def re_retire(apps, schema_editor):
    AIModel = apps.get_model("llm", "AIModel")
    AIModel.objects.filter(value__in=RELISTED_VALUES).update(
        is_active=False, retired_at=timezone.now())


class Migration(migrations.Migration):

    dependencies = [
        ("llm", "0005_aimodel_last_seen_at_aimodel_replaced_by_and_more"),
    ]

    operations = [
        migrations.RunPython(relist, re_retire),
    ]
