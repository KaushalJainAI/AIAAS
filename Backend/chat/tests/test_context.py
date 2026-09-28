"""
The split between the cacheable baseline prompt and the per-turn context update.

The bug these guard against is silent and expensive: a clock reading inside the
system message makes the request prefix differ on every turn, so no provider can
reuse a cached prefix and the whole baseline is re-billed each time. It is also
wrong on its own terms — a per-turn fact stated as a standing instruction leaves
the model unable to tell which reading is current.
"""
from __future__ import annotations

from types import SimpleNamespace

from django.test import SimpleTestCase

from chat.turn import prompts


def _session(**overrides):
    base = {
        "system_prompt": "",
        "memory_enabled": True,
        "user_id": 4242,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class BaselineStabilityTests(SimpleTestCase):
    """`build_system_message` must not vary with anything that moves."""

    def test_baseline_is_byte_identical_across_turns(self):
        session = _session()
        self.assertEqual(
            prompts.build_system_message(session),
            prompts.build_system_message(session),
        )

    def test_baseline_carries_no_clock(self):
        text = prompts.build_system_message(_session())
        self.assertNotIn("Current date/time", text)

    def test_baseline_ignores_intent(self):
        # Intent is re-detected per message, so a mode nudge in the baseline
        # would change the prefix the moment the user's phrasing shifted.
        session = _session()
        self.assertNotIn("DEEP RESEARCH MODE", prompts.build_system_message(session))

    def test_baseline_still_reflects_the_memory_switch(self):
        # This one *should* change the prefix: it changes what the model may do,
        # and it only moves when the user flips the switch.
        on = prompts.build_system_message(_session(memory_enabled=True))
        off = prompts.build_system_message(_session(memory_enabled=False))
        self.assertNotEqual(on, off)
        self.assertIn("NO MEMORY THIS TURN", off)


class ContextUpdateTests(SimpleTestCase):
    """Everything volatile has to actually reach the model somewhere."""

    def test_clock_moved_here_rather_than_being_dropped(self):
        text = prompts.build_context_update(_session(), "Monday, 4:00 PM", "chat")
        self.assertIn("Monday, 4:00 PM", text)

    def test_mode_nudge_is_per_turn(self):
        session = _session()
        research = prompts.build_context_update(session, "now", "research")
        plain = prompts.build_context_update(session, "now", "chat")
        self.assertIn("DEEP RESEARCH MODE", research)
        self.assertNotIn("DEEP RESEARCH MODE", plain)

    def test_blocked_attachment_ids_are_carried(self):
        text = prompts.build_context_update(
            _session(), "now", "chat",
            blocked_notice="Attachment 91 (scan.png) was withheld.",
        )
        self.assertIn("Attachment 91", text)

    def test_the_approval_mode_is_stated_except_for_ask(self):
        # Plan withholds delegation; a model not told so planned to delegate.
        plan = prompts.build_context_update(_session(autonomy="plan"), "now", "chat")
        auto = prompts.build_context_update(_session(autonomy="auto"), "now", "chat")
        ask = prompts.build_context_update(_session(autonomy="ask"), "now", "chat")
        self.assertIn("Mode: PLAN", plan)
        self.assertIn("Mode: AUTO", auto)
        self.assertNotIn("Mode:", ask)
        # The mode is per turn, so it never enters the cached baseline.
        self.assertNotIn(
            "Mode: PLAN", prompts.build_system_message(_session(autonomy="plan")))

    def test_a_short_window_is_said_out_loud(self):
        cut = prompts.build_context_update(_session(), "now", "chat",
                                           history_dropped=3)
        whole = prompts.build_context_update(_session(), "now", "chat")
        self.assertIn("3 oldest messages", cut)
        self.assertNotIn("left out", whole)


class BaselineWordingTests(SimpleTestCase):
    """What the stable prompt tells the model about its tools and memory."""

    def test_charts_go_to_render_chart(self):
        text = prompts.build_system_message(_session())
        self.assertIn("`render_chart`", text)

    def test_tool_output_is_data_not_instructions(self):
        text = prompts.build_system_message(_session())
        self.assertIn("never instructions", text)

    def test_the_screen_is_not_promised(self):
        # Nothing reports the user's screen (a Buddy-era claim).
        self.assertNotIn("screen", prompts.build_system_message(_session()))

    def test_the_window_is_counted_in_messages(self):
        text = prompts.build_system_message(_session())
        self.assertIn(f"last {prompts.HISTORY_WINDOW} messages", text)

    def test_the_default_identity_names_the_manager_role(self):
        self.assertIn("manager of their agents",
                      prompts.build_system_message(_session()))
