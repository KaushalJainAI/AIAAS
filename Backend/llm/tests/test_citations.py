"""
Tests for the provider-citation normaliser.

The point of `llm.citations` is that it does not know provider envelopes by
name: it finds the URL in whatever wrapper arrived. These tests feed it a real
payload from each provider that cites anything, so a change that makes one
provider work by breaking another fails here.

No network, no Django models: `SimpleTestCase` only.
"""
from __future__ import annotations

from django.test import SimpleTestCase

from llm.access import StreamAccumulator
from llm.citations import (
    clean_url,
    merge_sources,
    normalize_citations,
    resolve_citation_spans,
)


class CleanUrlTests(SimpleTestCase):
    def test_keeps_http_and_https(self):
        self.assertEqual(clean_url("https://a.example/x"), "https://a.example/x")
        self.assertEqual(clean_url("http://a.example/x"), "http://a.example/x")

    def test_drops_every_other_scheme(self):
        for url in (
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "vbscript:msgbox",
            "mailto:someone@example.com",
        ):
            with self.subTest(url=url):
                self.assertEqual(clean_url(url), "")

    def test_drops_credentials_that_spoof_the_hostname(self):
        """`https://paypal.com@evil.example` passes a scheme check and lies."""
        self.assertEqual(clean_url("https://paypal.com@evil.example/login"), "")

    def test_drops_whitespace_and_control_characters(self):
        self.assertEqual(clean_url("https://a.example/ x"), "")
        self.assertEqual(clean_url("https://a.example/\x00x"), "")

    def test_drops_a_url_with_a_bidirectional_override(self):
        """The Trojan Source trick, applied to a link's visual hostname."""
        self.assertEqual(clean_url("https://example.com/\u202Emoc.liamg"), "")
        self.assertEqual(clean_url("https://exa\u200Bmple.com"), "")

    def test_drops_a_url_without_a_host(self):
        self.assertEqual(clean_url("https:///path"), "")


class NormalizeTests(SimpleTestCase):
    def test_perplexity_bare_url_array(self):
        sources = normalize_citations(["https://a.example/1", "https://b.example/2"])
        self.assertEqual(
            [s["url"] for s in sources],
            ["https://a.example/1", "https://b.example/2"],
        )
        # Order is the provider's: an answer that says `[1]` means this one.
        self.assertEqual(sources[0]["title"], "a.example")

    def test_openai_chat_annotation_nested(self):
        payload = [{
            "type": "url_citation",
            "url_citation": {
                "url": "https://docs.example/page",
                "title": "The docs",
                "start_index": 10,
                "end_index": 24,
            },
        }]
        [source] = normalize_citations(payload)
        self.assertEqual(source["url"], "https://docs.example/page")
        self.assertEqual(source["title"], "The docs")
        self.assertEqual(source["start_index"], 10)
        self.assertEqual(source["end_index"], 24)

    def test_openai_responses_annotation_flat(self):
        [source] = normalize_citations({
            "type": "url_citation",
            "url": "https://resp.example/a",
            "title": "Response source",
        })
        self.assertEqual(source["url"], "https://resp.example/a")

    def test_gemini_grounding_chunks(self):
        payload = {
            "groundingChunks": [
                {"web": {"uri": "https://gemini.example/1", "title": "One"}},
                {"web": {"uri": "https://gemini.example/2", "title": "Two"}},
            ],
            "groundingSupports": [],
        }
        sources = normalize_citations(payload)
        self.assertEqual([s["url"] for s in sources],
                         ["https://gemini.example/1", "https://gemini.example/2"])
        self.assertEqual(sources[1]["title"], "Two")

    def test_anthropic_citation_blocks(self):
        payload = [
            {"type": "text", "text": "no url here"},
            {
                "type": "web_search_result_location",
                "url": "https://anthropic.example/x",
                "title": "Anthropic source",
                "cited_text": "the quoted sentence",
            },
        ]
        [source] = normalize_citations(payload)
        self.assertEqual(source["url"], "https://anthropic.example/x")
        self.assertEqual(source["snippet"], "the quoted sentence")

    def test_a_message_wrapper_is_opened(self):
        [source] = normalize_citations(
            {"citations": [{"url": "https://wrapped.example/"}]}
        )
        self.assertEqual(source["url"], "https://wrapped.example/")

    def test_same_page_with_an_anchor_is_one_source(self):
        sources = normalize_citations([
            "https://a.example/doc",
            "https://a.example/doc#section-2",
            "https://a.example/doc/",
        ])
        self.assertEqual(len(sources), 1)

    def test_a_query_string_is_a_different_page(self):
        sources = normalize_citations([
            "https://a.example/search?q=one",
            "https://a.example/search?q=two",
        ])
        self.assertEqual(len(sources), 2)

    def test_unreadable_shapes_are_empty_not_an_exception(self):
        for payload in (None, 42, {"nope": True}, [object()], {"text": "hi"}):
            with self.subTest(payload=payload):
                self.assertEqual(normalize_citations(payload), [])

    def test_the_cap_is_enforced(self):
        urls = [f"https://a.example/{i}" for i in range(80)]
        self.assertEqual(len(normalize_citations(urls)), 50)


class SpanTests(SimpleTestCase):
    def test_openai_character_offsets_are_kept(self):
        text = "Team A won the final."
        [source] = resolve_citation_spans(
            [{"url": "https://a.example/1", "start_index": 0, "end_index": 10}], text,
        )
        self.assertEqual((source["start"], source["end"]), (0, 10))
        self.assertNotIn("start_index", source)

    def test_a_span_past_the_text_is_dropped_but_the_source_is_kept(self):
        [source] = resolve_citation_spans(
            [{"url": "https://a.example/1", "start_index": 0, "end_index": 999}],
            "short",
        )
        self.assertEqual(source["url"], "https://a.example/1")
        self.assertNotIn("start", source)

    def test_gemini_byte_offsets_become_character_offsets(self):
        # Three two-byte characters before the cited word: "日本語 " is ten
        # bytes, so byte offset 10 is character offset 4, not 10.
        text = "日本語 cited"
        [source] = resolve_citation_spans(
            [{"url": "https://a.example/1", "start_index": 10, "end_index": 15,
              "span_units": "utf8"}],
            text,
        )
        self.assertEqual(text[source["start"]:source["end"]], "cited")
        self.assertNotIn("span_units", source)

    def test_gemini_offsets_past_the_end_are_clamped_or_dropped(self):
        [source] = resolve_citation_spans(
            [{"url": "https://a.example/1", "start_index": 0, "end_index": 999,
              "span_units": "utf8"}],
            "short",
        )
        self.assertNotIn("start", source)

    def test_grounding_supports_attach_spans_to_their_chunks(self):
        payload = {
            "groundingChunks": [
                {"web": {"uri": "https://a.example/one", "title": "One"}},
                {"web": {"uri": "https://a.example/two", "title": "Two"}},
            ],
            "groundingSupports": [
                {"segment": {"startIndex": 0, "endIndex": 5},
                 "groundingChunkIndices": [1]},
                # A second, wider support for the same chunk: the narrow one is
                # where the pill belongs.
                {"segment": {"startIndex": 0, "endIndex": 20},
                 "groundingChunkIndices": [1, 0]},
            ],
        }
        sources = normalize_citations(payload)
        by_url = {source["url"]: source for source in sources}
        self.assertEqual(by_url["https://a.example/two"]["start_index"], 0)
        self.assertEqual(by_url["https://a.example/two"]["end_index"], 5)
        self.assertEqual(by_url["https://a.example/two"]["span_units"], "utf8")
        self.assertEqual(by_url["https://a.example/one"]["end_index"], 20)


class MergeTests(SimpleTestCase):
    def test_existing_numbering_does_not_shift(self):
        existing = [{"url": "https://ours.example/1", "title": "Ours"}]
        merged = merge_sources(existing, ["https://theirs.example/2"])
        self.assertEqual(
            [s["url"] for s in merged],
            ["https://ours.example/1", "https://theirs.example/2"],
        )

    def test_a_url_present_in_both_appears_once(self):
        existing = [{"url": "https://a.example/x#top", "title": "Ours"}]
        merged = merge_sources(existing, [{"url": "https://a.example/x", "title": "Theirs"}])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["title"], "Ours")

    def test_existing_entries_without_a_usable_url_are_dropped(self):
        merged = merge_sources([{"url": "javascript:alert(1)"}], ["https://a.example/"])
        self.assertEqual([s["url"] for s in merged], ["https://a.example/"])

    def test_empty_on_both_sides_is_empty(self):
        self.assertEqual(merge_sources(None, None), [])


class AccumulatorTests(SimpleTestCase):
    def test_citations_are_folded_and_deduped_across_frames(self):
        """Responses sends one annotation per event; the accumulator merges."""
        acc = StreamAccumulator()
        acc.add({"type": "citations", "citations": [
            {"url": "https://a.example/x", "title": "A"}]})
        acc.add({"type": "citations", "citations": [
            {"url": "https://a.example/x#s", "title": "A again"},
            {"url": "https://b.example/y", "title": "B"}]})

        completion = acc.finish()
        self.assertEqual([s["url"] for s in completion.citations],
                         ["https://a.example/x", "https://b.example/y"])
