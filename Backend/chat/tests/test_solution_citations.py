"""Team solutions the turn read become a chip under the answer (K1.1).

The chip lists what the model *read*, not what it cited, so the record is
"these were looked at". What matters here: the two tool shapes are both read
(a list from search, one record from get_solution), a repeat is stored once,
the list stops at five, and a failed call stores nothing.
"""
from __future__ import annotations

import json

from asgiref.sync import async_to_sync
from django.test import SimpleTestCase

from chat.turn.agent import SOLUTIONS_KEPT, _SIDE_EFFECTS, _apply_side_effects
from chat.turn.events import Event


class _Sink:
    def __init__(self):
        self.events = []

    async def __call__(self, event, payload):
        self.events.append((event, json.loads(json.dumps(payload))))


def _row(sid, **over):
    """One result as `solutions.search.present` returns it."""
    return {
        "id": sid,
        "problem": f"Problem {sid}",
        "solved_by": "Asha",
        "last_known_true": "2026-10-02",
        "checks_needed": [],
        "shared_with_org": True,
        "claims": [],
        **over,
    }


def _apply(name, args, result, meta, sink):
    async_to_sync(_apply_side_effects)(name, args, json.dumps(result), meta, sink)


class SolutionsUsedTests(SimpleTestCase):
    def test_search_results_are_recorded_and_streamed(self):
        meta, sink = {}, _Sink()
        results = [_row(4, checks_needed=["The queue is new_queue"], doubtful="Old fix"), _row(9)]
        _apply("search_solutions", {"query": "celery stuck"},
               {"results": results, "scope": "organisation"}, meta, sink)

        used = meta["solutions_used"]
        self.assertEqual([u["id"] for u in used], [4, 9])
        first = used[0]
        self.assertEqual(first["problem"], "Problem 4")
        self.assertEqual(first["solved_by"], "Asha")
        self.assertEqual(first["last_known_true"], "2026-10-02")
        self.assertEqual(first["checks_needed"], 1)
        self.assertTrue(first["doubtful"])
        self.assertFalse(used[1]["doubtful"])
        self.assertEqual(sink.events, [(Event.SOLUTIONS_UPDATE, {"solutions": used})])

    def test_a_repeat_is_stored_once_and_the_list_stops_at_five(self):
        meta, sink = {}, _Sink()
        _apply("search_solutions", {}, {"results": [_row(1), _row(2)]}, meta, sink)
        _apply("search_solutions", {}, {"results": [_row(2), _row(3)]}, meta, sink)
        _apply("search_solutions", {}, {"results": [_row(n) for n in range(10, 20)]}, meta, sink)

        ids = [u["id"] for u in meta["solutions_used"]]
        self.assertEqual(len(ids), SOLUTIONS_KEPT)
        self.assertEqual(len(set(ids)), len(ids))
        self.assertEqual(ids[:3], [1, 2, 3])

    def test_get_solution_returns_one_record_and_is_read(self):
        meta, sink = {}, _Sink()
        _apply("get_solution", {"id": 6}, _row(6), meta, sink)
        self.assertEqual([u["id"] for u in meta["solutions_used"]], [6])

    def test_an_error_result_stores_nothing(self):
        meta, sink = {}, _Sink()
        _apply("get_solution", {"id": 6}, {"error": "No such solution."}, meta, sink)
        _apply("search_solutions", {}, {"error": "Give the problem to search for."}, meta, sink)
        self.assertNotIn("solutions_used", meta)
        self.assertEqual(sink.events, [])

    def test_an_empty_search_records_an_empty_list(self):
        meta, sink = {}, _Sink()
        _apply("search_solutions", {}, {"results": [], "scope": "organisation"}, meta, sink)
        self.assertEqual(meta["solutions_used"], [])

    def test_both_tools_are_registered(self):
        self.assertIs(_SIDE_EFFECTS["search_solutions"], _SIDE_EFFECTS["get_solution"])

    def test_the_event_name_is_the_wire_name(self):
        self.assertEqual(Event.SOLUTIONS_UPDATE, "solutions_update")
