"""What `populate_models.py` may contain, as opposed to what it does.

The seed is a script rather than a migration, so nothing about its *contents*
is checked by running it — the database ends up looking the same whether a row
was omitted by accident or on purpose. These read the source instead, which is
the same technique `ShippedDefaultTests` and `FallbackPinningTests` use.

Three properties, each of which has produced a silently wrong catalogue:

**Values are unique across every provider.** `AIModel.value` is globally unique
and `update_or_create` keys on it alone, so two seed rows sharing a value do
not collide loudly — the second silently wins and re-points the row's provider
FK. NVIDIA's Nemotron 3 Ultra is `nvidia/nemotron-3-ultra-550b-a55b` on both
NIM and OpenRouter, which is genuinely the same string on two providers, and
seeding both meant the OpenRouter row was never in the picker at all. There is
no symptom to notice unless you were already looking for that model.

**A retired id is not also a seeded id.** `RETIRED_MODEL_VALUES` and the
provider lists are pruned in the same edit, so leaving a value in both means the
row is written and then deactivated on every boot — it reads as "retired" in
the file while `update_or_create` has just reinstated it.

**A default resolves to a real model.** The shipped default, the fallback
default and the platform fold model are all strings in other modules. A
catalogue edit that drops the row they name does not break anything loudly
either; it breaks the first chat turn.
"""
import ast
import pathlib

from django.test import SimpleTestCase

import populate_models

SEED_PATH = pathlib.Path(__file__).resolve().parents[2] / 'populate_models.py'


def _seed_source():
    return SEED_PATH.read_text(encoding='utf-8')


def _seed_tree():
    return ast.parse(_seed_source())


def _providers():
    """The `providers = [...]` literal from inside `populate()`, as AST.

    Parsed rather than imported or regexed. Importing would run
    `django.setup()` and the whole seed is a local variable inside a function,
    so neither gets at the data; and a regex over a format with nested braces,
    multi-line calls and a trailing `description=` returns an empty set without
    raising when it misses — which is how this file's first draft let
    `test_no_two_rows_share_a_value` pass on zero rows.
    """
    func = next(
        node for node in ast.walk(_seed_tree())
        if isinstance(node, ast.FunctionDef) and node.name == 'populate'
    )
    assign = next(
        node for node in ast.walk(func)
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == 'providers' for t in node.targets)
    )
    return assign.value.elts


#: `m()`'s own parameter names, so a call's **positional** arguments can be
#: read as named fields. `is_free` in particular is passed positionally almost
#: everywhere (`m(name, value, True, CHAT_CAPS)`), and a reader that only looks
#: at keywords sees every free row as a paid one with no price.
_M_SIGNATURE = (
    'name', 'value', 'is_free', 'caps', 'input_price', 'output_price',
    'cached_price', 'context', 'cache_write_price', 'effort',
    'default_effort', 'description',
)


def _rows():
    """(slug, name, value, kwargs) for every `m(...)` row in the seed."""
    for provider in _providers():
        # Each provider is a dict literal, so its entries are `key=value`
        # nodes (ast.keyword belongs to a `func(...)` call, not a `{...}`).
        fields = {
            key.value: value
            for key, value in zip(provider.keys, provider.values)
            if isinstance(key, ast.Constant)
        }
        slug = ast.literal_eval(fields['slug'])
        for call in fields['models'].elts:
            kwargs = dict(zip(_M_SIGNATURE, call.args))
            kwargs.update({kw.arg: kw.value for kw in call.keywords})
            # name and value resolve eagerly so callers can match on them as
            # strings; the rest stay as nodes for `_literal`, which answers
            # None for a name it cannot read rather than raising.
            name = ast.literal_eval(kwargs.pop('name'))
            value = ast.literal_eval(kwargs.pop('value'))
            yield slug, name, value, kwargs


def _seeded_values():
    return [(value, slug) for slug, _, value, _ in _rows()]


def _literal(node):
    """The value of an AST node, or None when it is not a plain literal.

    `effort=EFFORT_STANDARD` and `caps=MULTIMODAL_CAPS` are names, and a test
    about shape should not care what a shared constant holds.
    """
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return None



class SeedUniquenessTests(SimpleTestCase):
    def test_no_two_rows_share_a_value(self):
        values = [v for v, _ in _seeded_values()]
        self.assertEqual(
            len(values), len(set(values)),
            'duplicate AIModel.value in the seed: the second row silently '
            'overwrites the first and re-points its provider, so the first '
            'model is missing from the picker with no error anywhere',
        )

    def test_the_assertion_catches_one(self):
        # The invariant is only worth having if it actually fires, and this is
        # the case that is otherwise invisible in review: NVIDIA serves the
        # same id string on two providers.
        providers = [
            {'slug': 'nvidia', 'models': [{'value': 'nvidia/nemotron-3-ultra'}]},
            {'slug': 'openrouter', 'models': [{'value': 'nvidia/nemotron-3-ultra'}]},
        ]
        with self.assertRaises(ValueError) as caught:
            populate_models._assert_unique_values(providers)
        self.assertIn('nvidia/nemotron-3-ultra', str(caught.exception))
        self.assertIn('openrouter', str(caught.exception))

    def test_distinct_values_pass(self):
        populate_models._assert_unique_values([
            {'slug': 'openrouter', 'models': [{'value': 'a/one'}]},
            {'slug': 'nvidia', 'models': [{'value': 'b/two'}]},
        ])

    def test_populate_calls_the_assertion(self):
        # Otherwise the check exists but nothing runs it.
        source = _seed_source()
        self.assertIn('_assert_unique_values(providers)', source)


class SeedRetirementTests(SimpleTestCase):
    def test_nothing_is_seeded_and_retired_at_once(self):
        seeded = {v for v, _ in _seeded_values()}
        retired = set(populate_models.RETIRED_MODEL_VALUES)
        overlap = seeded & retired
        self.assertFalse(
            overlap,
            f'{sorted(overlap)} are in both the provider lists and '
            f'RETIRED_MODEL_VALUES, so the row is written and then deactivated '
            f'on every boot',
        )

    def test_the_retired_list_has_no_duplicates(self):
        # A repeated entry reads as two separate decisions and is one.
        retired = populate_models.RETIRED_MODEL_VALUES
        self.assertEqual(len(retired), len(set(retired)))


class ShippedDefaultsAreRealModelsTests(SimpleTestCase):
    """The three model ids the platform names on its own behalf."""

    def _seed_values(self):
        return {v for v, _ in _seeded_values()}

    def test_the_platform_fallback_is_seeded(self):
        from llm import fallback

        self.assertIn(fallback.DEFAULT_FALLBACK_MODEL, self._seed_values())

    def test_the_context_fold_fallbacks_are_seeded_when_set(self):
        # These are env-driven, so an empty setting is a legitimate answer —
        # that is how the fallback chain resolves in order.
        import llm.access as access

        for attr in ('SUMMARY_PROVIDER', 'SUMMARY_MODEL'):
            value = (getattr(access, attr, '') or '').strip()
            if not value:
                continue
            self.assertIn(
                value, self._seed_values(),
                f'llm.access.{attr} names a model the seed does not carry, so '
                f'the fold falls through to the next provider without ever '
                f'reaching it',
            )


class SeedRowShapeTests(SimpleTestCase):
    #: Rows whose cost is decided upstream rather than by a rate card. The
    #: routers publish pricing of `-1` because *which* model answers is chosen
    #: per request, and the OpenAI media rows bill per image or per second
    #: rather than per token, so a per-million figure for either would be a
    #: number we invented. They also have no text context window, being image
    #: and video endpoints rather than chat models.
    ROUTERS = ('openrouter/auto', 'openrouter/free', 'openrouter/pareto-code')
    PER_UNIT = ('gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'sora-2-pro')

    def test_every_paid_row_declares_a_price(self):
        # `llm/pricing.py` reads `is_free` to tell a genuinely free model from
        # one whose price nobody filled in, and reports only the latter as
        # `unpriced`. A paid row with no price is the case that misleads, and
        # it is silent: the picker renders a number, just the wrong one.
        for slug, name, value, kwargs in _rows():
            if value in self.ROUTERS or value in self.PER_UNIT:
                continue
            if _literal(kwargs.get('is_free')) is True:
                continue
            price = _literal(kwargs.get('input_price', '0.0000'))
            self.assertTrue(
                price and price != '0.0000',
                f'{value} ({name}, {slug}) is not free and declares no input '
                f'price, so it is billed as unpriced rather than as $0',
            )

    def test_a_free_row_is_not_also_priced(self):
        # Both at once is a contradiction the picker renders: the badge says
        # free and the cost line says otherwise.
        for slug, name, value, kwargs in _rows():
            if _literal(kwargs.get('is_free')) is not True:
                continue
            for field in ('input_price', 'output_price'):
                price = _literal(kwargs.get(field, '0.0000'))
                self.assertIn(
                    price, ('0.0000', '0', 0, 0.0, None),
                    f'{value} ({name}, {slug}) is marked free but declares '
                    f'{field}={price}',
                )

    def test_every_row_declares_a_usable_context_window(self):
        # `llm/budget.py` reads this and turns it into the prompt budget, so a
        # wrong figure is a silently oversized or starved request — not a
        # cosmetic one. A row we chose to offer should state its real number
        # rather than admit we did not look. The exceptions are all rows where
        # the server genuinely cannot know the number, or where the figure is
        # not a chat window at all: the routers have no fixed window by
        # definition, Ollama's tag is a local install, OpenCode Zen publishes
        # no context figures, and an embedding model is limited by the
        # vectors it can take rather than by conversation length (OpenAI's
        # `text-embedding-3-large` really is 8191, not 8192).
        for slug, name, value, kwargs in _rows():
            if value in self.ROUTERS or value in self.PER_UNIT:
                continue
            if slug in ('ollama', 'opencode'):
                continue
            if 'embedding' in name.lower() or 'embed' in value.lower():
                continue
            context = _literal(kwargs.get('context'))
            self.assertIsInstance(
                context, int,
                f'{value} ({name}, {slug}) declares no literal context window, '
                f'so `llm/budget.py` cannot size a request against it',
            )
            self.assertGreaterEqual(
                context, 4096,
                f'{value} ({name}, {slug}) declares a context window below '
                f'the smallest window we offer',
            )
