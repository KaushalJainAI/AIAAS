# Provider citation & source-reference wire formats, and how to normalise them

Scope: every marker style and annotation shape a multi-model Django backend is likely to meet when it streams
assistant text plus a `sources[]` array to a React frontend that turns `[1]` into a pill numbered against
`sources[index-1]`.

Local context I verified before researching (relevant to the recommendations):

- `Backend/llm/handlers/llm_base.py:363` forwards a **top-level** `chunk["citations"]` verbatim as
  `{"type": "citations", "citations": [...]}`. That is the Perplexity/xAI shape (a bare list of URLs), not
  OpenAI's annotations shape.
- `Backend/llm/handlers/responses_api.py:224` handles only `response.output_text.delta`, reasoning deltas,
  `response.output_item.done` (function calls only), `response.completed`, `response.failed`/`error`,
  `response.incomplete`. **Nothing reads `response.output_text.annotation.added`, `web_search_call.action.sources`,
  `file_search_call.results`, or `groundingMetadata`.** Today every structured citation from the Responses API is
  silently discarded.
- `Backend/chat/turn/history.py:114` re-attaches citations from earlier turns, so whatever shape we normalise to
  has to be persistable and stable across turns (not recomputed from offsets at render time).

---

## 1. OpenAI Chat Completions: `message.annotations`, and the legacy `[1]`

### Takeaway
Chat Completions has exactly one citation channel: `choices[].message.annotations[]`, whose entries are
discriminated by `type` — `"url_citation"` (web search) or `"file_citation"` (retrieval/vector stores). Web
citations carry character offsets and a URL; file citations carry a `file_id` and no URL at all. Any `[1]` in the
prose is **model-authored text**, not a reference to the annotations array.

### Cited Findings

- Web-search models on Chat Completions return annotations of `type: "url_citation"` with a nested
  `url_citation` object holding `url`, `title`, `start_index`, `end_index` — [OpenAI web search guide](https://platform.openai.com/docs/guides/tools-web-search); the same four fields are mirrored in
  LiteLLM's `ChatCompletionAnnotationURLCitation` TypedDict
  (`litellm/types/llms/openai.py:600-619`, LiteLLM 1.83.0 installed in `Backend/venv`).
- Real payload (Chat Completions, `gpt-5-search-api`-class models — annotations sit next to `content`, not inside it):

```json
{
  "id": "chatcmpl-B9pQ...",
  "object": "chat.completion",
  "model": "gpt-5-search-api",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "Spain won Euro 2024, beating England 2-1 in the final [1].",
        "annotations": [
          {
            "type": "url_citation",
            "url_citation": {
              "url": "https://www.uefa.com/euro2024/news/spain-wins-euro-2024",
              "title": "Spain win Euro 2024",
              "start_index": 0,
              "end_index": 52
            }
          }
        ]
      }
    }
  ]
}
```

- Note the **nested** shape: Chat Completions wraps the fields in `url_citation`; the Responses API does not.
  This is the single most common parsing bug when one code path serves both APIs.
- File citations from Retrieval / vector stores use the same array with `type: "file_citation"` and
  `{file_id, filename, index}`, where `index` is a position in the assistant message's annotation/file list rather
  than a character offset — no URL is present, so a web-shaped `sources[]` cannot represent them without a
  synthetic link (see §9).
- LiteLLM's Responses→Chat shim shows the same asymmetry: it rebuilds `url_citation` annotations out of Responses
  annotations at `litellm/responses/litellm_completion_transformation/transformation.py:2032-2040`.
- The `[1]` in prose is not tied to `annotations` by OpenAI. In practice the search models order annotations by
  first appearance, which makes `annotations[i]` ≈ "source i+1" *most* of the time — but nothing in the contract
  guarantees it, and duplicate annotations for the same URL are normal.

### Inferences
- Treat offsets as the source of truth and the literal `[1]` as decoration: if we trust `[1]` numbering we will
  mis-number as soon as the model writes `[2]` before `[1]` or cites the same URL twice.
- `file_citation` must map to a distinct source kind (`kind: "file"`), because rendering it as a web link produces
  a dead pill.

### Gaps
- OpenAI does not publish a strict guarantee that `annotations[]` order equals marker order; I found no primary
  source stating it either way.

---

## 2. OpenAI Responses API: `output_text.annotations`, `web_search_call`, `file_search_call`

### Takeaway
Responses moves citations *inside* the content part (`content[0].annotations[]`), flattens the fields
(no nested `url_citation` object), and adds two side-channel items — `web_search_call` (with optional
`action.sources` and `results`) and `file_search_call` (with optional `results`) — that carry the *full* candidate
list rather than just what was cited.

### Cited Findings

- Web search output is two items: a `web_search_call` whose `action.type` is `search` | `open_page` | `find_in_page`
  (search actions usually include `queries`), and a `message` whose `content[0].annotations[]` hold
  `{type:"url_citation", start_index, end_index, url, title}` — [OpenAI web search guide](https://platform.openai.com/docs/guides/tools-web-search). Verbatim example from that page:

```json
[
  {
    "type": "web_search_call",
    "id": "ws_67c9fa0502748190b7dd390736892e100be649c1a5ff9609",
    "status": "completed",
    "action": { "type": "search", "query": "latest news about AI" }
  },
  {
    "id": "msg_67c9fa077e288190af08fdffda2e34f20be649c1a5ff9609",
    "type": "message",
    "status": "completed",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "On March 6, 2025, several news...",
        "annotations": [
          {
            "type": "url_citation",
            "start_index": 2606,
            "end_index": 2758,
            "url": "https://...",
            "title": "Title..."
          }
        ]
      }
    ]
  }
]
```

- `sources` (the complete list of URLs consulted, often longer than the cited set) is only returned when you opt
  in with `include: ["web_search_call.action.sources"]`, reached in Python as
  `response.output[i].action.sources[].url` — [same page](https://platform.openai.com/docs/guides/tools-web-search). The docs explicitly say "the number of sources is often greater than the number of citations", and that
  real-time third-party feeds appear there labelled `oai-sports`, `oai-weather`, `oai-finance`.
- Image search results are a third shape: `web_search_call.results[]` with
  `{type:"image_result", image_url, thumbnail_url, source_website_url, caption}` (needs
  `include: ["web_search_call.results"]` + `search_content_types: ["image"]`) — that is the only place a provider
  hands us a ready-made `thumbnail`.
- `file_search` returns a `file_search_call` item plus annotations of
  `{type:"file_citation", index, file_id, filename}` — note **`index` is a character index into the text**, and the
  same file is annotated repeatedly — [OpenAI file search guide](https://platform.openai.com/docs/guides/tools-file-search):

```json
{
  "type": "file_citation",
  "index": 992,
  "file_id": "file-2dtbBZdjtDKS8eqWxqbgDi",
  "filename": "deep_research_blog.pdf"
}
```

- Streamed, the same annotations arrive as SSE events; the response object also exposes the completed message so a
  handler can read `response.output[*].content[*].annotations` at `response.completed` without handling
  per-annotation events. (Our `responses_api.py` currently handles neither.)

### Inferences
- `include: ["web_search_call.action.sources"]` is the closest OpenAI analogue to Perplexity's `search_results`:
  a numbered-able source list independent of citations. If our backend wants a "N sources consulted" footer, it
  must request this explicitly — it is off by default and costs tokens.
- Because `file_citation.index` is a character offset, file citations *can* be rendered in place; because
  Chat Completions' `file_citation.index` is not, the two must not share one parser.

### Gaps
- I did not verify whether `response.output_text.annotation.added` events include the full annotation object or
  only a delta pointer; the docs describe the non-streaming object only. Implement against
  `response.output_item.done` / `response.completed` to be safe.

---

## 3. Anthropic Messages API: citation content blocks, `search_result`, `web_search_result_location`

### Takeaway
Anthropic does not cite with markers at all. It **interleaves extra `text` blocks** into `content[]`, where each
cited block carries `citations: [...]` describing the *source document* plus the *quoted span*. The discriminator
`type` tells you which coordinate system the citation uses: `char_location`, `page_location`,
`content_block_location`, `search_result_location`, `web_search_result_location`. There is no numeric marker and
no required ordering.

### Cited Findings

- With `citations: {enabled: true}` on documents, responses contain multiple text blocks; the citation array sits
  on the *text block being supported* — [Anthropic citations docs](https://platform.claude.com/docs/en/build-with-claude/citations):

```json
{
  "content": [
    { "type": "text", "text": "According to the document, " },
    {
      "type": "text",
      "text": "the grass is green",
      "citations": [
        {
          "type": "char_location",
          "cited_text": "The grass is green. ",
          "document_index": 0,
          "document_title": "Example Document",
          "start_char_index": 0,
          "end_char_index": 20
        }
      ]
    },
    { "type": "text", "text": " and " },
    {
      "type": "text",
      "text": "the sky is blue",
      "citations": [
        {
          "type": "char_location",
          "cited_text": "The sky is blue.",
          "document_index": 0,
          "document_title": "Example Document",
          "start_char_index": 20,
          "end_char_index": 36
        }
      ]
    },
    {
      "type": "text",
      "text": ". Information from page 5 states that "
    },
    {
      "type": "text",
      "text": "water is essential",
      "citations": [
        {
          "type": "page_location",
          "cited_text": "Water is essential for life.",
          "document_index": 1,
          "document_title": "PDF Document",
          "start_page_number": 5,
          "end_page_number": 6
        }
      ]
    },
    {
      "type": "text",
      "text": ". The custom document mentions "
    },
    {
      "type": "text",
      "text": "important findings",
      "citations": [
        {
          "type": "content_block_location",
          "cited_text": "These are important findings.",
          "document_index": 2,
          "document_title": "Custom Content Document",
          "start_block_index": 0,
          "end_block_index": 1
        }
      ]
    }
  ]
}
```

- Index semantics, verbatim from the docs: **document indices 0-indexed across all document content blocks in the
  request (spanning all messages)**; character indices 0-indexed with **exclusive** end; page numbers 1-indexed
  with exclusive end; block indices 0-indexed with exclusive end.
- Streaming: each citation arrives as its own delta, `content_block_delta` with
  `delta.type == "citations_delta"` and a single `delta.citation` object attached to the *current* text block —
  [Anthropic citations docs, "Streaming support"](https://platform.claude.com/docs/en/build-with-claude/citations). That means a block's citation list is only complete at `content_block_stop`.
- `search_result` is the RAG input shape (works in tool results *and* directly in a user message). Response
  citations for it are `search_result_location` — [Anthropic search results docs](https://platform.claude.com/docs/en/build-with-claude/search-results):

```json
{
  "type": "search_result",
  "source": "https://docs.company.com/api-reference",
  "title": "API Reference - Authentication",
  "content": [{ "type": "text", "text": "All API requests must include an API key..." }],
  "citations": { "enabled": true }
}
```

```json
{
  "type": "search_result_location",
  "cited_text": "All API requests must include an API key in the Authorization header. ...",
  "source": "https://docs.company.com/api-reference",
  "title": "API Reference - Authentication",
  "search_result_index": 0,
  "start_block_index": 0,
  "end_block_index": 1
}
```

- `search_result_location` is the **only Anthropic citation type that carries a `url`**, and it is the only one
  that maps 1:1 onto a web `sources[]` entry without a lookup table. `source` may be a non-URL identifier
  (`kb://article-1234` is an explicitly allowed example).
- Server-side `web_search` returns `web_search_result_location`, which carries the URL directly plus an opaque
  `encrypted_index` — [Anthropic web search tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool):

```json
{
  "type": "text",
  "text": "Claude Shannon was born on April 30, 1916, in Petoskey, Michigan",
  "citations": [
    {
      "type": "web_search_result_location",
      "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
      "title": "Claude Shannon - Wikipedia",
      "encrypted_index": "Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..",
      "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician, ..."
    }
  ]
}
```

- `encrypted_index` is opaque and must be echoed back if we replay the conversation to Anthropic; it cannot be
  used to look anything up in our own store.
- Usage accounting for server tools: `usage.server_tool_use.web_search_requests` (same page).

- **`cite` tags.** Anthropic's Messages API does not define an inline `<cite>` markup; citations are the structured
  blocks above. `<cite>` / `<cite index="...">` is a *prompt-level* convention (Claude is frequently instructed to
  wrap quoted spans in `<cite>` tags, and some hosted surfaces emit them). I found no primary Anthropic source
  specifying a `<cite>` wire format, so it must be treated as untrusted prose (see Gaps).

### Inferences
- "Anthropic cite blocks are out of document order" is structural, not a bug: blocks are emitted in *generation*
  order, and `document_index` refers to the request's document list. Numbering sources by `document_index` will
  produce pills numbered 0,2,1 relative to the prose. Number by **first appearance in the response** instead.
- Because a citation lives on the block that it supports, the offset for rendering is "start of that block's text
  in the concatenated answer" → we get a span for free *if* we concatenate blocks in order. That is a cleaner
  contract than OpenAI's absolute offsets.
- `<cite>` tags, if present, should be stripped from the rendered text and (at best) used as a heuristic anchor —
  never as the citation source of truth.

### Gaps
- No primary source found for a `<cite>` tag wire format inside Messages API responses; treat all `cite` markup as
  prompt-derived text. Also unverified: whether `citations` can appear on `thinking` blocks (docs only show `text`).

---

## 4. Google Gemini: `groundingMetadata` (generateContent) vs `url_citation` annotations (Interactions API)

### Takeaway
Gemini has **two generations of shape** and they are not interchangeable. Legacy `generateContent` returns
`candidates[].groundingMetadata` with `groundingChunks[]` (the sources) and `groundingSupports[]` (claim → chunk
index spans, in **bytes**). The 2026 Interactions API instead returns OpenAI-style `url_citation` annotations
inside `model_output` text blocks. Any `[1]` in Gemini prose is model behaviour, not API structure.

### Cited Findings

- Legacy shape (field names and semantics verified against Google's API reference, which documents
  `groundingSupports[].segment.startIndex/endIndex` as "measured in **bytes**", `groundingChunkIndices` as
  "indices into `grounding_chunk` … [1,3,4] means grounding_chunk[1], [3], [4] are attributed to the claim", and
  `confidenceScores` 0–1) — [Generative Language API reference](https://ai.google.dev/api/generate-content).
  Reconstructed, faithfully to those field names:

```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [{ "text": "Spain won Euro 2024, defeating England 2-1 in the final. This victory marks Spain's record fourth title." }]
      },
      "groundingMetadata": {
        "webSearchQueries": ["UEFA Euro 2024 winner", "Euro 2024 final score"],
        "groundingChunks": [
          { "web": { "uri": "https://www.aljazeera.com/sports/euro-2024-final", "title": "aljazeera.com" } },
          { "web": { "uri": "https://www.uefa.com/euro2024/news/spain-wins-euro-2024", "title": "uefa.com" } }
        ],
        "groundingSupports": [
          {
            "segment": { "startIndex": 0, "endIndex": 56, "text": "Spain won Euro 2024, defeating England 2-1 in the final." },
            "groundingChunkIndices": [0, 1],
            "confidenceScores": [0.94, 0.81]
          },
          {
            "segment": { "startIndex": 57, "endIndex": 124, "text": "This victory marks Spain's record fourth title." },
            "groundingChunkIndices": [1],
            "confidenceScores": [0.88]
          }
        ],
        "searchEntryPoint": { "renderedContent": "<div class=\"...\">…Google's required search-suggestion HTML…</div>" }
      }
    }
  ]
}
```

- The 2026 Interactions API replaces that with typed steps and URL citations carrying offsets — verbatim from
  [Gemini grounding docs](https://ai.google.dev/gemini-api/docs/google-search):

```json
{
  "type": "model_output",
  "content": [
    {
      "type": "text",
      "text": "Spain won Euro 2024, defeating England 2-1 in the final. This victory marks Spain's record fourth European Championship title.",
      "annotations": [
        {
          "type": "url_citation",
          "url": "https://www.aljazeera.com/sports/euro-2024-final",
          "title": "aljazeera.com",
          "start_index": 0,
          "end_index": 56
        },
        {
          "type": "url_citation",
          "url": "https://www.uefa.com/euro2024/news/spain-wins-euro-2024",
          "title": "uefa.com",
          "start_index": 57,
          "end_index": 124
        }
      ]
    }
  ]
}
```

- `title` from Google is a **domain** ("uefa.com"), not a page title — a UI that renders `title` verbatim will show
  bare domains, unlike OpenAI where `title` is a real headline. `groundingChunks[].web.title` has the same
  domain-only character.
- `google_search_call` (queries) and `google_search_result` (`search_suggestions` HTML) accompany the answer;
  Google's ToS requires displaying the `searchEntryPoint.renderedContent` widget when you show Search-grounded
  results — [Gemini grounding docs](https://ai.google.dev/gemini-api/docs/google-search).
- Streaming caveat, verbatim: "If the response is streaming, the `grounding_chunk_indices` refer to the indices
  across all responses. It is the client's responsibility to accumulate the grounding chunks from all responses
  (while maintaining the same order)." — [API reference](https://ai.google.dev/api/generate-content).
- LiteLLM normalises the legacy shape into OpenAI `url_citation` annotations and takes **only the first** chunk
  index for the span's URL, which silently drops the other cited sources on that segment —
  `litellm/llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py:2021-2073`.

### Inferences
- The `[1]` markers people see in Gemini answers are generated by the model (Google's grounding prompt encourages
  bracketed numeric citations), not produced by the API. `groundingSupports` is the authoritative mapping, so a
  `[1]`-based renderer must not assume `[1] == groundingChunks[0]`.
- Byte offsets are a genuine correctness hazard: slicing a JS string (UTF-16 code units) with byte indices
  misplaces every citation after the first emoji or CJK character. Use `TextEncoder`/`TextDecoder` or convert
  byte→code-point offsets server-side (Python: `len(text.encode()[:i].decode())`).
- Because LiteLLM collapses multi-chunk supports to one URL, a backend that relies on LiteLLM's annotations loses
  sources Google actually attributed. Parse `groundingMetadata` directly if fidelity matters.

### Gaps
- I could not confirm from a primary source whether current `generateContent` (not Interactions) ever emits
  `citationMetadata` (the old PaLM attributed-text field) alongside `groundingMetadata`; older docs referenced it.

---

## 5. Perplexity Sonar: `citations`, `search_results`, and the bracket zoo

### Takeaway
Perplexity is the one provider whose numbering is **authoritative and 1-indexed**: `citations[i]` is source
`[i+1]`. The marker glyph varies by model/effort (`[1]`, `[web:1]`, and in older/web-app surfaces fullwidth
`【1】`), so the parser must accept several bracket alphabets but must never renumber.

### Cited Findings

- Perplexity's own migration/cookbook docs describe the marker contract explicitly: "The model inserts numbered
  references like `[1]`, `[2]` in the text, and the corresponding source URLs arrive in the `search_results`
  output item"; and "Each search result has a numeric `id` that corresponds to the `[N]` reference in the text" —
  [Streaming Citation Parsing](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations).
- Effort levels change the marker alphabet, verbatim: "Different effort levels use different citation formats —
  `fast` uses `[1]`, while `low` uses `[web:1]`." — [same page](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations).
- Multi-search answers share a single id space across several `search_results` items; keeping only the first batch
  is called out as the failure mode that makes citations "look hallucinated" — [same page](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations).
- Legacy Sonar Chat Completions returns two top-level fields next to `choices`: `citations` (ordered list of URL
  strings, 1-indexed by marker) and `search_results` (rich objects with `title`, `url`, `date`, and sometimes
  `snippet`/`last_updated`). LiteLLM consumes exactly these two fields by name —
  `litellm/llms/perplexity/chat/transformation.py:174-251` — and the local backend already forwards the list at
  `Backend/llm/handlers/llm_base.py:363`.
- LiteLLM's converter is the clearest published statement of the numbering rule:

```python
citation_pattern = r"\[(\d+)\]"                    # markers in text
citation_number_to_url = {}
for i, citation in enumerate(citations):
    citation_number_to_url[i + 1] = citation       # 1-indexed, authoritative
...
url_citation = {"url": url, "title": title, "start_index": match.start(), "end_index": match.end()}
```

  i.e. it rewrites Perplexity's markers into OpenAI `url_citation` annotations, taking `title` from
  `search_results[].title` by URL match and falling back to `""`.
- `【1】` / `【1†source】`: fullwidth lenticular brackets with an optional `†source` suffix. These are **not**
  documented by Perplexity's API reference; they are the rendering used by Perplexity's consumer product and by
  OpenAI's browsing/deep-research output (the `†source` variant is characteristic of OpenAI's agentic browsing
  text, not of Sonar). Treat them as an observed-in-the-wild variant to be parsed defensively, not as a spec.

### Inferences
- Because Perplexity numbering is authoritative, a UI that renumbers by appearance will disagree with the prose
  whenever the model cites out of order or repeats a source. This is the one provider where "trust the number"
  beats "trust the order".
- `search_results` is the only Perplexity field with `title`/`date`; the `citations` list alone gives bare URLs, so
  a sources array built from `citations` only will have empty titles.
- Fullwidth brackets should be normalised to ASCII before the marker pass, but the pill must be rendered from the
  original text span so that deletion/replacement doesn't shift later offsets.

### Gaps
- I found no primary Perplexity documentation for the `【…】` glyphs; the API docs only ever show `[N]` and
  `[web:N]`. The `【1†source】` form in particular is better attributed to OpenAI's browsing output than to Sonar.
- Sonar's legacy `chat/completions` endpoint now sits behind a migration banner in Perplexity's docs; the Agent
  API (Responses-shaped) is the documented path, so the legacy `citations` field's long-term availability is
  unclear.

---

## 6. Mistral, Cohere, xAI/Grok, Groq, Together

### Takeaway
Two of these five have first-class structured citations (Mistral, Cohere), two have side-channel search results
(xAI, Groq), and one has none (Together). Only Cohere's citations carry **source text spans** in the classic
`start`/`end` sense; Mistral's are *positional chunks inside the content array*, which is a fundamentally
different coordinate system.

### Cited Findings

**Mistral** — citations are inline *content chunks*, not annotations. `message.content` may be a string **or an
array** alternating `{"type":"text"}` and `{"type":"reference","reference_ids":[0]}`, with the referenced objects
supplied by the tool call result — [Mistral Citations & References](https://docs.mistral.ai/inference/conversations/citations):

```json
{
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "tool_calls": null,
        "content": [
          { "type": "text", "text": "The 2024 Nobel Peace Prize was awarded to Nihon Hidankyo ... in Oslo, Norway " },
          { "type": "reference", "reference_ids": [0] },
          { "type": "text", "text": "." }
        ]
      }
    }
  ]
}
```

The reference objects (from the tool result) are keyed by the same ids:

```json
{
  "0": {
    "url": "https://en.wikipedia.org/wiki/2024_Nobel_Peace_Prize",
    "title": "2024 Nobel Peace Prize",
    "snippets": [["The 2024 Nobel Peace Prize ...", "They will receive the prize at a ceremony on 10 December 2024 ..."]],
    "description": null,
    "date": "2024-11-26T17:39:55.057454",
    "source": "wikipedia"
  }
}
```

Consequences: there is **no marker in the text at all** (`content` is a list of parts, and the reference part *is*
the marker), and `reference_ids` are not necessarily dense or ordered — the model may cite `[2]` without `[0]`.

**Cohere** (v2 `/v2/chat`) — `message.citations[]` with `{start, end, text, sources[]}`, where each source is
`{"type":"document","id":…,"document":{"id","title","snippet"}}` or a tool source. LiteLLM's converter documents
the exact keys it reads and the fallback it invents when a document has no URL — `source.get("url") or
f"source:{source.get('id','unknown')}"` — `litellm/llms/cohere/chat/v2_transformation.py:320-363`; Cohere's own
guide is [RAG Citations](https://docs.cohere.com/docs/rag-citations). Cohere is the provider most likely to produce
a **synthetic, non-http `source:` identifier**, which our link renderer must tolerate.

**xAI / Grok** — Live Search attaches a top-level `citations` list to the response (the documented usage is
literally `print(response.citations)`) — [xAI Live Search](https://docs.x.ai/docs/guides/live-search). It is the
same *concept* as Perplexity's `citations` (URLs, not annotation objects), and Grok writes bracketed numbers into
prose itself. Shape of individual entries is not shown in the docs page I could read (client-side rendering), so
assume `string[]` until measured.

**Groq** — no `citations` field. Compound/agentic responses put retrieval in the tool envelope:
`choices[0].message.executed_tools[]` with `search_results.results[] = {title, url, content, score}` (plus
`images[]`), alongside `browser_results` and `code_results`; schema confirmed in Groq's published OpenAPI component
`ExecutedTool` — [Groq Compound docs](https://console.groq.com/docs/compound/systems/compound). There is no
per-claim offset; mapping to prose therefore requires parsing the model's own `[1]` markers or matching the
`content` snippet against the answer.

**Together** — Together serves open-weight models through an OpenAI-compatible endpoint and does not add citation
metadata; any `[1]` is model text with no backing array.

### Inferences
- Mistral breaks the "offset into a string" assumption that every other provider satisfies. A normaliser that
  requires `(start, end)` cannot represent Mistral; it needs a fallback "insertion point" span of zero width at the
  position of the reference chunk in the reconstructed text.
- Groq's `score` field is the only provider-supplied relevance signal besides Gemini's `confidenceScores`; useful
  for ordering a "sources consulted" list but not for prose numbering.
- For Together/Mistral-without-tools, the honest UI is "no citations", not "hallucinate a sources array from the
  URLs the model typed".

### Gaps
- xAI: exact element type of `citations[]` (string vs object) and whether Grok emits inline markers under Live
  Search are unverified; the docs page I fetched renders client-side and showed only `print(response.citations)`.
- Cohere: I could not fetch the rendered `rag-citations` body (Astro/JS payload only); the field names above come
  from LiteLLM's reader plus Cohere's documented v2 response model, not from the Cohere page text itself.
- Together: absence of citations is inferred from its OpenAI-compatibility, not from an explicit statement.

---

## 7. LiteLLM: how it normalises, and where it loses information

### Takeaway
LiteLLM's rule is "everything becomes OpenAI `url_citation` annotations, and the provider's raw list is also
stapled onto the response object as an attribute". It normalises Perplexity, Gemini/Vertex, and Cohere that way;
it does *not* normalise Anthropic citation blocks (those stay as provider-specific `citations` on text blocks), and
it drops multi-source supports. The `citations` "extra field" in the modern SDK is an ad-hoc attribute, not a
typed field on `ModelResponse`.

### Cited Findings

- Version in this repo: **litellm 1.83.0** (`Backend/venv/Lib/site-packages/litellm-1.83.0.dist-info`). In that
  version `Choices` (`types/utils.py:1369`) and `ModelResponse` (`types/utils.py:1867`) have **no declared
  `citations` field**; providers `setattr(model_response, "citations", …)` instead — see the Perplexity
  transformation, which sets both `citations` and `search_results` as attributes "for backward compatibility"
  (`litellm/llms/perplexity/chat/transformation.py:247-251`).
- The typed annotation surface is `ChatCompletionAnnotation` / `ChatCompletionAnnotationURLCitation`
  (`litellm/types/llms/openai.py:600-619`) — `type: "url_citation"` only, i.e. LiteLLM has no first-class concept of
  a file citation or a document citation in the Chat shape.
- Perplexity: `[N]` markers → `url_citation` annotations with `start_index/end_index` taken from the **marker span**
  (`match.start()`/`match.end()`), title joined from `search_results` by URL. Marker numbers past the end of
  `citations` are silently skipped (`if citation_number in citation_number_to_url`).
  `litellm/llms/perplexity/chat/transformation.py:174-251`.
- Gemini/Vertex: `groundingSupports` → one annotation per support, using `groundingChunkIndices[0]` only, with
  `title` taken from `groundingChunks[].web.title` (a domain).
  `litellm/llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py:2021-2073`. Raw grounding metadata is
  preserved separately in `_hidden_params["vertex_ai_grounding_metadata"]` and surfaced to Langfuse as its own
  observation (`integrations/langfuse/langfuse.py:1197-1218`).
- Cohere: citations → annotations, one per `sources[]` entry, with `url` falling back to `source:<id>`.
  `litellm/llms/cohere/chat/v2_transformation.py:320-363`.
- Cost accounting keys off the presence of annotations: Chat Completions "only include `url_citation` annotations
  when a web search call is made", used to decide server-side-tool billing —
  `litellm/litellm_core_utils/llm_cost_calc/tool_call_cost_tracking.py:317-323`.
- Anthropic: LiteLLM's Anthropic response type keeps citation objects as `Optional[List[Dict[str, Any]]]` on text
  blocks (`types/llms/anthropic_messages/anthropic_response.py:16`), and its streaming delta union includes a
  `"citations"` delta type (`types/llms/anthropic.py:397`) — i.e. it passes them through rather than flattening.
- Bedrock Nova grounding has its own typed shape (`citationsContent` with `citations[].location.web` /
  `location.document`, `types/llms/bedrock.py:99-168`), which LiteLLM also models separately rather than
  normalising.

### Inferences
- If we adopt LiteLLM as the single normaliser we inherit three specific defects: (a) one URL per Gemini segment,
  (b) no `file_citation` representation, (c) Anthropic citations arriving in a completely different field. That is
  a strong argument for normalising in our own handler layer and using LiteLLM only as transport.
- LiteLLM's Perplexity converter is worth copying almost verbatim for our own marker pass (it already handles the
  `[N]` → span conversion and the title join), with one fix: record *all* sources for a segment rather than the
  first.

### Gaps
- I did not find a `DocumentCitation` type anywhere in litellm 1.83.0 (grep over the installed package returns no
  such symbol), so any documentation referring to "LiteLLM `DocumentCitation`" describes a different/older or
  proxy-layer type than what this repo ships.

---

## 8. Normalisation guidance: one source shape, two numbering regimes

### Takeaway
The providers split into two irreconcilable numbering regimes, and the UI must know which one it is in:
**author-numbered** (Perplexity, Grok, Groq-compound, any model writing `[1]`) where `[n]` means `sources[n-1]`,
and **appearance-ordered** (OpenAI, Anthropic, Gemini, Mistral, Cohere) where the provider gives spans or
structure and the display number is ours to assign. Mature UIs solve this by rendering citations from **spans**,
not from a marker number, and by keeping the provider's own labels as secondary metadata.

### Cited Findings

- **LibreChat** normalises everything into one `sources` concept built from tool output rather than from
  annotations: `collectSources()` walks every search turn's `organic[]` / `topStories[]` and de-duplicates by
  `link` with **last-write-wins** (`client/src/components/Chat/Messages/Content/sources.ts`), then
  `getUniqueDomainSources()` collapses to one source per domain for the collapsed header. Citations render through
  a `SourceHovercard` keyed by `citationId`, with a `CitationContext` for hover-highlighting, and file citations
  are a distinct branch (`refType === 'file'`, opening `FilePreviewDialog`) —
  `client/src/components/Web/Citation.tsx`.
- **Open WebUI** parses markers with a real markdown tokenizer extension rather than regex: `start(src)` triggers
  on `/\[\d/`, then one rule matches **runs of adjacent bracket groups** —
  `/^(\[(?:\d+(?:#[^,\]\s]+)?(?:,\s*\d+(?:#[^,\]\s]+)?)*)\])+/` — so `[1][2,3][4#bar]` becomes a *single* token
  carrying `ids:number[]` and `citationIdentifiers:string[]`; it explicitly refuses to match footnotes (`[^`) and
  renders `token.raw` as a fallback when no source resolves —
  `src/lib/utils/marked/citation-extension.ts`.
- **LobeChat** normalises to a `GroundingSearch` object (`{searchQueries, citations[], imageResults,
  imageSearchQueries}`) rendered by one `SearchGrounding` component, and — directly relevant to the bad-URL edge
  case — it filters `citations?.filter(item => !!item.url)` and guards the favicon host with `new URL(url)` in a
  try/catch because "some providers (e.g. OpenRouter built-in web search) may emit citations with an empty/invalid
  url, and `new URL(undefined)` would throw and crash the whole message render"
  (`src/features/Conversation/Messages/components/SearchGrounding.tsx`, referencing lobehub issue #15043).
- Anthropic's own docs describe the correct mental model for the appearance regime: read text blocks in order,
  concatenate, and attach each block's `citations` to the span that block occupies — they give a step-by-step
  parsing recipe for exactly this in [Get structured data with citations](https://platform.claude.com/docs/en/build-with-claude/citations).
- Perplexity's docs describe the opposite regime for author-numbered content, and warn that a UI which doesn't
  resolve every `[N]` against the accumulated `search_results` produces output that "look[s] hallucinated" —
  [Streaming Citation Parsing](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations).

### Inferences

Recommended internal contract (superset of the current `{url,title?,snippet?,thumbnail?,favicon?,publisher?,source?}`):

```jsonc
{
  "sources": [
    {
      "id": "s_1",                     // stable, server-assigned, never reused
      "url": "https://…",              // null for file sources
      "title": "…",
      "snippet": "…",                  // Perplexity snippet, Cohere document.snippet, Groq content, Anthropic cited_text
      "thumbnail": "…",                // OpenAI image_result.thumbnail_url
      "favicon": "…",                  // server-derived from url host (LobeChat does this client-side)
      "publisher": "uefa.com",         // Gemini web.title (domain), else derived host
      "source": "openai|anthropic|gemini|perplexity|mistral|cohere|xai|groq|litellm",
      "kind": "web|file|document",     // file_citation / char_location → non-web
      "labels": ["1", "web:1"],        // the marker(s) the model actually wrote, if any
      "citedText": "…",                // Anthropic cited_text / page or block range
      "requestIndex": 0                // document_index / search_result_index / reference_id, for debugging
    }
  ],
  "spans": [
    { "start": 0, "end": 52, "sourceIds": ["s_1"], "mode": "replace|insert" }
  ],
  "numbering": "author|appearance",
  "render": { "searchEntryPointHtml": "…" }   // Gemini ToS widget, when present
}
```

Alignment rules that follow from the evidence:

1. **Spans beat numbers.** Every provider except Mistral gives (or lets us derive) a span; render pills by
   offset (`spans[]`), and only fall back to `[n]`-matching when `spans` is empty.
2. **Two numbering regimes, decided by provider, not by content.** `numbering: "author"` → the pill label is the
   marker the model wrote, and `sources[n-1]` must be honoured exactly (Perplexity). `numbering: "appearance"` →
   assign 1..N by first cited appearance, and *never* show the provider's own index (Anthropic `document_index`,
   Gemini chunk index, Mistral `reference_id`) because those are 0-based and out of prose order.
3. **Dedupe by canonicalised URL, merge labels.** Same URL cited twice (OpenAI duplicates annotations per
   occurrence; Perplexity repeats `[1]` many times) must be one source with several spans and one label set.
4. **Non-web sources get `kind`, not a fake URL.** `file_citation` (no URL), Cohere `source:<id>`, Anthropic
   `kb://…` — render an icon + title, never an anchor.
5. **Keep the provider's raw blob.** Anthropic `encrypted_index` must survive replay; Gemini
   `searchEntryPoint.renderedContent` must be shown for ToS; both argue for storing `providerRaw` per message
   alongside the normalised shape (our `chat/turn/history.py` re-attach path makes this cheap).
6. **Order sources for display by first citation, not by provider array order.** Otherwise Anthropic/Gemini lists
   start at the document/chunk the model happened to mention last.

### Gaps
- I have implementation detail (not policy docs) for all three UIs; none of them documents *why* their numbering
  scheme was chosen. LobeChat's normalisation happens partly server-side in its agent-runtime, which I did not
  read, so its source-object shape is inferred from the consuming component.
- No UI I examined solves the "sources arrive after the text while streaming" problem by re-numbering live; they
  all appear to render markers as inert until sources land. I found no primary source on a better pattern.

---

## 9. Edge cases and the rules that follow

### Takeaway
Every edge case here reduces to one design decision: **parse markdown structure, not raw text, and treat markers
as display state that can be unresolved.** The failure modes below are all documented in the wild (Open WebUI's
adjacent-bracket rule, LobeChat's invalid-URL crash, Perplexity's "collect every batch" warning).

### Cited Findings
- **Adjacent markers** `[1][2]` are a single logical citation group; Open WebUI merges runs into one token with
  `ids: [1,2]` and also supports `[1,2]` comma lists and `[1#foo]` suffixes —
  `src/lib/utils/marked/citation-extension.ts`. `[1#foo]` is how OpenRouter-style providers disambiguate two
  sources that share a display number; ignore the suffix at your peril (it is the dedupe key).
- **`[1]` inside code** is a real hazard because a model explaining "write `sources[1]`" or an array literal
  `arr[1]` produces the same bytes as a citation. FFmpeg-style `[1]` (input stream specifier) appears in shell
  examples too. Regex-only parsers corrupt these; Open WebUI sidesteps it by hooking the *inline markdown*
  tokenizer, which by construction never runs inside fenced/inline code.
- **`[1]` with no sources**: Perplexity's guidance is explicit — "If a `[N]` reference in the text has no matching
  `id` … display the reference number without a link rather than crashing" —
  [Streaming Citation Parsing](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations). LiteLLM
  instead silently drops the marker's annotation, leaving a bare `[1]` in the text.
- **Markers past the end of the array**: same rule; and note LiteLLM's Perplexity path *only* creates annotations
  for markers it can resolve (`if citation_number in citation_number_to_url`), so a backend reading LiteLLM's
  annotations cannot distinguish "no citation" from "citation we dropped".
- **Duplicated URLs**: OpenAI emits one annotation per occurrence (its own file-search example shows the same
  `file_id` four times, twice at `index: 992` and twice at `index: 1176`) —
  [file search guide](https://platform.openai.com/docs/guides/tools-file-search). LibreChat de-dupes with
  last-write-wins keyed on `link`.
- **Invalid / empty / non-http URLs**: LobeChat filters falsy `url` and wraps `new URL()` in try/catch after
  crashes from OpenRouter built-in web search citations with empty URLs (lobehub issue #15043, referenced in
  `SearchGrounding.tsx`); Cohere/LiteLLM can hand you `source:<id>` pseudo-URLs; Anthropic `search_result.source`
  explicitly allows internal identifiers like `kb://article-1234` —
  [search results docs](https://platform.claude.com/docs/en/build-with-claude/search-results). `javascript:` and
  `data:` must be rejected at render, not just at ingest.
- **Sources arriving after the text while streaming**: Perplexity streams `search_results` events *before*
  `response.output_text.delta` events, but citations can still reference a batch the client has not seen; the docs
  require accumulating across events and warn that deltas "may split `[N]` across chunks" —
  [same page](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations). Anthropic's `citations_delta`
  arrives after the text of its block has already streamed.
- **Byte-vs-character offsets**: Gemini measures `segment.startIndex/endIndex` in bytes —
  [API reference](https://ai.google.dev/api/generate-content). OpenAI/Anthropic use character indices (Anthropic:
  0-indexed, exclusive end). A JS frontend slicing with Gemini offsets will corrupt any non-ASCII answer.

### Inferences

Concrete rules to implement server-side (Django) and enforce in the frontend:

1. **Marker grammar** (apply only outside code/inline-code/link destinations, i.e. on markdown AST text nodes):
   `\[\s*(\d+)\s*\]`, `\[([\d,\s]+)\]`, `\[(\d+)#([^\]\s]+)\]`, `\[web:(\d+)\]`, `【\s*(\d+)\s*(?:†[^】]*)?】`.
   Normalise fullwidth → ASCII before matching; keep the original span for replacement.
2. **Grouping**: collect a maximal run of adjacent bracket groups into one pill group; comma lists expand into
   multiple ids; identical id in the same run collapses (`[1][1]` → one pill).
3. **Resolution**: id → source via the regime (`author`: `sources[id-1]` when the provider's array is
   1-indexed-by-marker; `appearance`: id is a display label we assigned and stored in `labels`). Unresolved →
   render the raw text, add a `dropped_markers` counter to telemetry.
4. **Streaming**: hold back a trailing partial marker (`/\[[0-9,\s#]*$/` and `【[^】]*$`) in the splitter — the
   same trick `llm_base.py`'s `splitter` already uses for torn tags — so `[1` isn't rendered as literal text and
   then rewritten.
5. **Two-phase render**: emit `sources` + `spans` in a `source` event as soon as they're known (before or during
   text), render pills keyed by `source.id`; never key by array position, so late-arriving sources don't renumber
   existing pills.
6. **URL policy**: allow `http`/`https` only for `href`; treat everything else as `kind: "document"` with no link;
   strip credentials; display host (registered domain) rather than full URL; `rel="noopener noreferrer nofollow"`.
7. **Offset safety**: convert Gemini byte offsets to code-point offsets at ingest; store `spans` as code-point
   offsets and let the frontend convert to UTF-16 once, at render.
8. **Cap and log**: dedupe to a max (e.g. 50), keep `providerRaw` for audit, and count markers-that-didn't-resolve
   as a quality metric per model — that is the signal that a provider's marker contract changed.

### Gaps
- No primary source describes how to reconcile an author-numbered provider that *also* supplies spans (Perplexity
  with LiteLLM-style annotation shims); I chose "author number wins for the label, span wins for placement", which
  is an inference, not a documented practice.
- No evidence found on how providers behave when a marker number exceeds the source list by a large amount (e.g.
  `[99]`); all documented behaviour is per-marker skip-or-render-raw.

---

## The matrix: provider → payload → annotation vs inline → normalisation

| Provider / API | Exact fields in payload | Structured or inline | Numbering | Recommended normalisation |
|---|---|---|---|---|
| OpenAI Chat Completions (web search) | `choices[0].message.annotations[].type="url_citation"`, `.url_citation{url,title,start_index,end_index}` | Structured | Appearance | One source per unique `url`; span from offsets; ignore prose `[n]`; title from `url_citation.title` |
| OpenAI Chat Completions (retrieval / files) | `annotations[].type="file_citation"`, `{file_id, filename, index}` | Structured, no URL | Appearance | `kind:"file"`, `url:null`, key by `file_id`; do **not** reuse the web span parser (`index` is not a char offset here) |
| OpenAI Chat Completions (plain model) | none; model may write `[1]` | Inline text only | Author (model's) | If a `sources[]` was supplied by us, map `[n]` to it; otherwise render literally |
| OpenAI Responses (`web_search`) | `output[].type="web_search_call"`, `.action{type,query,queries,sources[]}`, `.results[]`; `output[].content[0].annotations[]{type:"url_citation",start_index,end_index,url,title}` | Structured | Appearance | Sources from annotations; `action.sources` (opt-in via `include`) for "consulted" footer; `results[]` for images/thumbnails |
| OpenAI Responses (`file_search`) | `file_search_call{queries,results}`; `annotations[]{type:"file_citation",index,file_id,filename}` | Structured | Appearance | `kind:"file"`; `index` **is** a char offset here; optionally hydrate text from `file_search_call.results` |
| Anthropic Messages (`document` + citations) | `content[].type="text"`, `.citations[].type ∈ {char_location, page_location, content_block_location}`, `cited_text`, `document_index`, `document_title`, `start/end_char_index`, `start/end_page_number`, `start/end_block_index` | Structured, block-level | Appearance (doc index is request order) | Concatenate text blocks in order → span = block offset; label by first appearance; `kind:"document"`; store `document_index` as `requestIndex` only |
| Anthropic Messages (`search_result` RAG) | `citations[].type="search_result_location"`, `{source,title,cited_text,search_result_index,start_block_index,end_block_index}` | Structured | Appearance | `url = source` when it parses as http(s), else `kind:"document"`; title from `title` |
| Anthropic Messages (server `web_search`) | `citations[].type="web_search_result_location"`, `{url,title,encrypted_index,cited_text}`; `usage.server_tool_use.web_search_requests` | Structured | Appearance | `url` directly; persist `encrypted_index` in `providerRaw` for replay |
| Anthropic (streaming) | `content_block_delta` with `delta.type="citations_delta"`, `delta.citation{…}` | Structured, per-delta | Appearance | Buffer citations per content block index; flush at `content_block_stop` |
| Anthropic (prompt-level `<cite>`) | `<cite>`, `<cite index="…">` in prose | Inline text, non-contractual | n/a | Strip from text for display; never resolve to a source |
| Gemini `generateContent` | `candidates[].groundingMetadata{webSearchQueries[], groundingChunks[].web{uri,title}, groundingSupports[]{segment{startIndex,endIndex,text}, groundingChunkIndices[], confidenceScores[]}, searchEntryPoint.renderedContent}` | Structured, **byte** offsets | Appearance (chunk order ≠ prose order) | Source per `uri`; span per support (emit one span per chunk index, not just the first); convert bytes→code points; show `renderedContent` for ToS; `publisher = web.title` |
| Gemini Interactions API (2026) | `steps[].type="model_output"`, `.content[].type="text"`, `.annotations[]{type:"url_citation",url,title,start_index,end_index}`; `google_search_call.arguments.queries` | Structured | Appearance | Same as OpenAI Responses; `title` is a domain |
| Perplexity Sonar (legacy) | `citations: string[]`, `search_results[]{title,url,date,…}`; prose `[n]` | Hybrid: list + inline markers | **Author, 1-indexed** | `sources[i] = citations[i]`; never renumber; title join by URL from `search_results` |
| Perplexity Agent API | `search_results` output items `{id,title,url,snippet,date}`; prose `[n]` (fast) / `[web:n]` (low) | Hybrid | **Author**, shared id space across batches | Accumulate every batch; map `id → source`; accept `[web:n]` |
| Perplexity / consumer surfaces | `【1】`, `【1†source】` in prose | Inline text | Author | Normalise fullwidth brackets; strip `†suffix`; resolve like `[n]` |
| Mistral | `message.content` **array**: `{type:"text",text}`, `{type:"reference",reference_ids:[n]}`; reference objects `{url,title,snippets[][],date,source}` from the tool result | Structured, positional parts | Author-ish (`reference_ids` arbitrary) | Reconstruct text by concatenating parts; span = zero-width insertion at reference part position; `snippet = snippets[0][0]`; `publisher = source` |
| Cohere v2 | `message.citations[]{start,end,text,sources[]{type,id,document{id,title,snippet},url?}}` | Structured | Appearance | One source per `sources[]` entry; `url` may be absent → `kind:"document"`; LiteLLM's `source:<id>` fallback is a smell, prefer `null` |
| xAI / Grok (Live Search) | top-level `citations` (list; element type unverified), prose bracket markers | Hybrid | Author (assumed) | Treat like Perplexity: list is authoritative, map `[n]` → `citations[n-1]` |
| Groq (Compound) | `message.executed_tools[]{type,arguments,search_results{results[]{title,url,content,score},images[]},browser_results}` | Side-channel, no spans | n/a | Build `sources[]` from `search_results.results`; no pills unless the model also wrote markers; `score` for ordering |
| Together (open-weight) | none | Inline only (if any) | n/a | No sources array; render text literally |
| LiteLLM (as normaliser) | `ChatCompletionAnnotation{type:"url_citation",url_citation{…}}`; ad-hoc `response.citations`, `response.search_results` attributes; Anthropic/Bedrock citations left provider-specific | Mixed | Mixed | Use as transport only; it loses multi-chunk Gemini supports, has no `file_citation`, and skips unresolvable markers |

### Takeaway
No two providers agree on where a citation lives (message-level array, content-part annotation, per-text-block
array, content-part chunk, or a bare URL list) or on what a number means. The only shape that survives all of them
is `sources[]` + `spans[]` + an explicit `numbering` regime, with the provider's own label kept as metadata.

### Cited Findings
- The matrix rows above are sourced from: [OpenAI web search](https://platform.openai.com/docs/guides/tools-web-search), [OpenAI file search](https://platform.openai.com/docs/guides/tools-file-search), [Anthropic citations](https://platform.claude.com/docs/en/build-with-claude/citations), [Anthropic search results](https://platform.claude.com/docs/en/build-with-claude/search-results), [Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Gemini grounding](https://ai.google.dev/gemini-api/docs/google-search), [Gemini API reference](https://ai.google.dev/api/generate-content), [Perplexity streaming citations](https://docs.perplexity.ai/docs/cookbook/articles/streaming-citations), [Mistral citations](https://docs.mistral.ai/inference/conversations/citations), [Cohere RAG citations](https://docs.cohere.com/docs/rag-citations), [xAI Live Search](https://docs.x.ai/docs/guides/live-search), [Groq Compound](https://console.groq.com/docs/compound/systems/compound), and LiteLLM 1.83.0 source in `Backend/venv/Lib/site-packages/litellm/` (`llms/perplexity/chat/transformation.py`, `llms/vertex_ai/gemini/vertex_and_google_ai_studio_gemini.py`, `llms/cohere/chat/v2_transformation.py`, `types/llms/openai.py`, `types/utils.py`).

### Inferences
- Implementing the matrix means ~6 parser branches, not 15: OpenAI-shaped (`url_citation`, covers Chat,
  Responses, Gemini Interactions), Anthropic-shaped (citation blocks), Gemini-legacy (`groundingMetadata`),
  index-list (`citations`/`search_results`/`executed_tools`), part-list (Mistral), and marker-only fallback.
- The frontend contract barely changes: keep `sources[]`, add `spans[]` + `numbering`, and stop deriving the pill
  number from `indexOf(source) + 1`.

### Gaps
- Element types for xAI `citations[]` and the presence/shape of inline markers in xAI and Groq prose remain
  unverified (both docs sites render client-side; search tooling was unavailable — `websearch` returned HTTP 402
  throughout this research, so all findings come from direct fetches of primary docs and installed source).
- Bedrock Nova (`citationsContent`) and Vertex `citationMetadata` are modelled in LiteLLM but I did not
  independently verify them against provider docs; if Bedrock is on the roadmap they need their own pass.
