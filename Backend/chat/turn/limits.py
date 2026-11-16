"""
The chat orchestrator's limits, as one account has set them.

A sub-agent carries its step, time and spend limits in its own config. Chat is
not configured that way — it is the user's own hands — so its limits are
account settings (`UserProfile.chat_*`, Settings → Orchestrator) and this is
the one place they are read. Each value is clamped into its range here as well
as validated at save, so a row written before a range moved still runs.
"""
from __future__ import annotations

from dataclasses import dataclass

from workflow_backend.thresholds import (
    DEFAULT_CHAT_SPEND_RUPEES,
    DEFAULT_CHAT_TURN_SECONDS,
    DEFAULT_MAX_STEPS,
    MAX_CHAT_TURN_SECONDS,
    MAX_MAX_STEPS,
    MIN_CHAT_TURN_SECONDS,
    MIN_MAX_STEPS,
    RUPEES_PER_MILLION_TOKENS,
)


@dataclass(frozen=True, slots=True)
class OrchestratorLimits:
    max_steps: int = DEFAULT_MAX_STEPS
    time_limit_seconds: int = DEFAULT_CHAT_TURN_SECONDS
    spend_cap_rupees: int = DEFAULT_CHAT_SPEND_RUPEES
    summarise_long_turns: bool = False

    @property
    def token_budget(self) -> int | None:
        """The spend cap as tokens of the turn's own model calls, or None.

        Converted at the blended rate the agent spend cap uses
        (`agents/spend.py::rupees_for`), so ₹500 means the same amount of work
        in chat as in an agent's settings.
        """
        if self.spend_cap_rupees <= 0:
            return None
        return int(self.spend_cap_rupees * 1_000_000 / RUPEES_PER_MILLION_TOKENS)


def _clamp(value, low: int, high: int, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(number, high))


def for_profile(profile) -> OrchestratorLimits:
    """The limits on `profile` (a `UserProfile`, or None for the defaults)."""
    if profile is None:
        return OrchestratorLimits()
    spend = getattr(profile, 'chat_spend_cap_rupees', DEFAULT_CHAT_SPEND_RUPEES)
    try:
        spend = max(0, int(spend))
    except (TypeError, ValueError):
        spend = DEFAULT_CHAT_SPEND_RUPEES
    return OrchestratorLimits(
        max_steps=_clamp(getattr(profile, 'chat_max_steps', None),
                         MIN_MAX_STEPS, MAX_MAX_STEPS, DEFAULT_MAX_STEPS),
        time_limit_seconds=_clamp(getattr(profile, 'chat_time_limit_seconds', None),
                                  MIN_CHAT_TURN_SECONDS, MAX_CHAT_TURN_SECONDS,
                                  DEFAULT_CHAT_TURN_SECONDS),
        spend_cap_rupees=spend,
        summarise_long_turns=bool(getattr(profile, 'chat_summarise_long_turns', False)),
    )


async def for_user(user_id: int) -> OrchestratorLimits:
    """Read the account's limits; the defaults when it has no profile yet."""
    from core.models import UserProfile

    profile = await UserProfile.objects.filter(user_id=user_id).afirst()
    return for_profile(profile)
