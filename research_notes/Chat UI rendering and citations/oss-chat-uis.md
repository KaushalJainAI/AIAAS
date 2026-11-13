# How major open-source chat UIs handle markdown, streaming, code blocks and citations

*All findings below were read directly from source on GitHub (raw file contents), not from blog posts. Commits pinned at time of inspection (2026-11-11):*

| System | Commit | Date | Notes |
| --- | --- | --- | --- |
| LibreChat (`danny-avila/LibreChat`) | [`e6567c7a68`](https://github.com/danny-avila/LibreChat/commit/e6567c7a68) | 2026-11-10 | `main`; client is React + `react-markdown@9` |
| assistant-ui (`assistant-ui/assistant-ui`) | [`21f88ceebb`](https://github.com/assistant-ui/assistant-ui/commit/21f88ceebb) | 2026-11-11 | monorepo; `@assistant-ui/react-markdown@0.14.25`, `@assistant-ui/react-streamdown@0.3.21` |
| LobeChat (`lobehub/lobe-chat`) | [`3f6ccbab65`](https://github.com/lobehub/lobe-chat/commit/3f6ccbab65) | 2026-11-11 | rendering implemented in `lobehub/lobe-ui` @ [`33729d46c5`](https://github.com/lobehub/lobe-ui/commit/33729d46c5) (2026-11-04) |
| Open WebUI (`open-webui/open-webui`) | [`b0e6098e94`](https://github.com/open-webui/open-webui/commit/b0e6098e94) | 2026-11-08 | version `0.13.3`; Svelte, not React |
| Chatbot UI (`mckaywrigley/chatbot-ui`) | [`81328b61d2`](https://github.com/mckaywrigley/chatbot-ui/commit/81328b61d2) | 2024-06-22 | **archived / unmaintained** since mid-2024 |

---

## 1. Markdown stack: exact plugin chains and file paths

### Takeaway
Only two of the five are `react-markdown` shops at the current `v10` line (assistant-ui and LobeChat-via-lobe-ui); LibreChat is still on `react-markdown@9` with a heavily customised remark/rehype chain, Open WebUI abandoned the React-markdown ecosystem entirely for `marked` lexer + Svelte token components, and Chatbot UI (archived) is the minimal `remark-gfm + remark-math` case with no rehype stage at all.

### Cited Findings

**LibreChat — `react-markdown@9` + 9 remark plugins + 2 rehype plugins**
- `client/package.json` pins `react-markdown: ^9.0.1`, `remark-gfm: ^4.0.0`, `remark-math: ^6.0.0`, `rehype-katex: ^6.0.3`, `rehype-highlight: ^6.0.0`, `remark-directive`, `remark-supersub`, `mdast-util-math`, `micromark-extension-math`, `micromark-extension-llm-math`, `dompurify: ^3.4.17`, `mermaid: ^11.17.2` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/package.json)
- The whole pipeline is centralised in one file so the whole-message renderer and the per-block renderer cannot drift: `getRemarkPlugins()`, `getRehypePlugins()`, `getMarkdownComponents()` in `client/src/components/Chat/Messages/Content/markdownConfig.ts` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- Remark chain order: `remarkApproxTilde` → `remark-supersub` → `remarkGfm` → `remarkDirective` → `artifactPlugin` → `[remarkMath, { singleDollarTextMath: false }]` → `remarkSingleDollarMath` (only when the user's `useLaTeXParsing` setting is on) → `unicodeCitation` → `mcpUIResourcePlugin` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- Rehype chain is only `[rehypeKatex]` then `[rehypeHighlight, { detect: false, ignoreMissing: true, subset: langSubset }]`; `katex/contrib/mhchem` is imported at module top for chemistry support — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- `remark-math` is aliased to `micromark-extension-llm-math` at the bundler level (vite/jest) so LLM-idiomatic delimiters parse; the user setting only gates ambiguous single-dollar math — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- Custom components replace `code, a, p, img, table, ul, ol, h1–h6, blockquote` plus five custom node types (`artifact`, `citation`, `highlighted-text`, `composite-citation`, `mcp-ui-resource`, `mcp-ui-carousel`) — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)

**assistant-ui — `react-markdown@10` with *no* bundled plugins**
- `@assistant-ui/react-markdown@0.14.25` depends on `react-markdown: ^10.1.0` and `micromark-util-html-tag-name`, with `@assistant-ui/react` as a peer — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/package.json)
- The README's canonical usage passes plugins from the app: `npm install ... react-markdown remark-gfm` then `<MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="aui-md" />` — i.e. `remark-gfm` is *not* a dependency of the package — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/README.md)
- A second, batteries-included renderer exists: `@assistant-ui/react-streamdown@0.3.21` built on `streamdown: ^2.7.1` plus `remark-rehype`, `rehype-raw`, `rehype-sanitize`, `rehype-harden`, `remend`, with optional peers `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`, `@streamdown/cjk` — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/package.json)
- Streamdown usage: `<StreamdownTextPrimitive plugins={{ code, math, mermaid }} shikiTheme={["github-light","github-dark"]} />` with `katex/dist/katex.min.css` imported by the app — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/README.md)

**LobeChat — `react-markdown@10` behind `@lobehub/ui`**
- `src/features/Conversation/Markdown/index.tsx` is a thin wrapper: it renders `<Markdown variant={'chat'} fontSize={…} componentProps={{ highlight: { fullFeatured: true, theme }, mermaid: { fullFeatured: false, theme } }} />` from `@lobehub/ui` — the plugin chain is **not** in the lobe-chat repo — [Source](https://github.com/lobehub/lobe-chat/blob/3f6ccbab65/src/features/Conversation/Markdown/index.tsx)
- `lobehub/lobe-ui` pins `react-markdown: ^10.1.0`, `remark-gfm: ^4.0.1`, `remark-math: ^6.0.0`, `rehype-raw: ^7.0.0`, `rehype-sanitize: ^6.0.0`, `rehype-github-alerts: ^4.2.0`, `remark-breaks`, `remark-cjk-friendly`, `katex`, and `@lobehub/streamdown: ^1.4.0` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/package.json)
- Remark order (`src/hooks/useMarkdown/useMarkdownRemarkPlugins.ts`): `remarkCjkFriendly` → `remarkMath` (if `enableLatex`, deliberately *before* GFM so `|` inside `$…$` is not read as a table delimiter) → `[remarkGfm, { singleTilde: false }]` → `remarkCjkAutolink` → `remarkBr`/`remarkGfmPlus`/`remarkVideo` (only when `!allowHtml`) → `remarkCustomFootnotes` → `remarkBreaks` (chat mode only), with `remarkPluginsAhead` / `remarkPlugins` consumer extension points — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRemarkPlugins.ts)
- Rehype order (`useMarkdownRehypePlugins.ts`): `rehypeRaw` then `rehypeSanitize` (both gated on `allowHtml`) → `rehypeGithubAlerts` → custom `rehypeKatex` + `rehypeKatexDir` → `rehypeCustomFootnotes` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts)
- lobe-ui also ships a parallel `StreamdownRender` that feeds the *same* remark/rehype arrays and the same `components` map into `@lobehub/streamdown`'s `<Streamdown>` with `granularity`, `smoothing` and `latexGuard` props — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx)

**Open WebUI — `marked` + custom extensions, no remark/rehype at all**
- `package.json` (v0.13.3): `marked: ^9.1.0`, `dompurify: ^3.4.17`, `highlight.js: ^11.9.0`, `katex: ^0.16.22`, `mermaid: ^11.17.2`, `shiki: ^4.0.1`, `panzoom: ^9.4.3` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/package.json)
- `src/lib/components/chat/Messages/Markdown.svelte` calls `marked.use()` for: `katex-extension`, `extension` (core), `citation-extension`, `footnote-extension`, `colon-fence-extension`, `disableSingleTilde`, `{ breaks: true }`, and three `mention-extension` instances (`@`, `#`, `$`). Parsing is `marked.lexer(processed)` — it never produces an HTML string — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown.svelte)
- Rendering is a recursive Svelte component tree over marked tokens: `MarkdownTokens.svelte` (block tokens) → `MarkdownInlineTokens.svelte` (inline tokens) → per-token components (`CodeBlock.svelte`, `KatexRenderer.svelte`, `HtmlToken.svelte`, `ColonFenceBlock.svelte`, `ConsecutiveDetailsGroup.svelte`, …) — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte)

**Chatbot UI — minimal, archived**
- `react-markdown: ^9.0.1`, `remark-gfm: ^4.0.0`, `remark-math: ^6.0.0`, `react-syntax-highlighter: ^15.5.0`; **no** rehype plugins — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/package.json)
- `<MessageMarkdownMemoized remarkPlugins={[remarkGfm, remarkMath]} components={{ p, img, code }} …>` — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx)

### Inferences
- LibreChat's single-source-of-truth `getRemarkPlugins()/getRehypePlugins()` module is the pattern that makes block-splitting safe: both renderers cannot drift, and the block splitter can re-derive the same mdast features (`gfm()`, `directive()`, `math()`) with micromark directly.
- If we want to stay on `react-markdown@10` + `remark-gfm`, assistant-ui's package is the closest architectural peer (same major of react-markdown, plugin-free core with an opt-in "batteries" sibling), whereas LibreChat and LobeChat both prove that a real product ends up with 6–10 remark plugins and 3–5 rehype plugins, so a plugin *registry* is worth designing for.

### Gaps
- LibreChat's `remarkSingleDollarMath`, `remarkApproxTilde` and `unicodeCitation` implementations are custom local packages (`~/utils`, `~/components/Web/plugin.ts`); I only verified the plugin *names and order*, not each algorithm.
- `@lobehub/ui`'s underlying syntax-highlighting engine (`src/Highlighter`) was not opened, so the highlighter library behind `fullFeatured: true` for LobeChat is unconfirmed.
- Whether LibreChat's `MarkdownLite.tsx` (a second, lighter renderer) is used for non-message surfaces was not verified.

---

## 2. Streaming: throttling, buffering, unterminated fences, and the O(n²) highlighter problem

### Takeaway
Nobody debounces the *text* itself; the four live projects all keep React/Svelte re-rendering per token but attack the quadratic cost at three different layers — **block-level memoisation** (LibreChat, LobeChat), **deferred/low-priority rendering** (assistant-ui), and **one-parse-per-animation-frame** (Open WebUI). Only LibreChat and Open WebUI have an explicit answer for the code-block re-highlight cost, and they are opposite: LibreChat throttles highlighting to 300 ms; Open WebUI re-highlights synchronously on every token.

### Cited Findings

**LibreChat — block splitting + incremental re-parse + 300 ms highlight throttle**
- `MarkdownBlocks.tsx` splits the message into top-level mdast blocks and wraps each in its own memoised `MarkdownBlock` whose comparator is `content` + running code/artifact/mermaid base indices + `animate`; the comment states the intent: "a completed block whose source slice and bases are unchanged across streamed tokens skips both re-parsing and re-rendering, so only the final, still-growing block re-parses" — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownBlocks.tsx)
- A finished message that mounts already-complete deliberately renders as **one** pipeline (`toWholeMessage`) instead of splitting, because "splitting it would buy memoization nothing uses, at the price of a whole extra parse … which is most of the cost of opening a long conversation" — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownBlocks.tsx)
- The splitter (`packages/chat/src/core/parts/splitMarkdown.ts`) uses micromark + `mdast-util-from-markdown` with `gfm()`, `directive()`, `math({singleDollarTextMath:false})`, and caches per message; on append-only growth it recomputes only from `reparseStart` (the start of the last two blocks: `stableBlockCount = children.length - 2`) because "an unfinished marker (such as `***` or `#`) can stop interrupting it when more text arrives" — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/packages/chat/src/core/parts/splitMarkdown.ts)
- Fallback to whole-message rendering when a block contains `definition`/`footnoteDefinition` nodes or a top-level `html` node, because reference definitions are document-scoped and raw HTML is escaped rather than parsed — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/packages/chat/src/core/parts/splitMarkdown.ts)
- Code highlighting is throttled, default **300 ms**: `DEFAULT_CODE_HIGHLIGHT_THROTTLE_MS = 300` (max 60 000) in `packages/data-provider/src/config.ts`, consumed by `useLazyHighlight.ts` via `CodeHighlightThrottleContext` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/packages/data-provider/src/config.ts), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/Parts/useLazyHighlight.ts)
- `useLazyHighlight` keeps the *previous* tokenised nodes if the input key (`lang\0code`) is unchanged, and otherwise shows raw text while a highlight is pending — "The caller receives current raw text until then, avoiding repeated switches between raw and highlighted code during streaming" — with a `generation` ref to discard stale async results and `lowlight` loaded via dynamic `import('lowlight')` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/Parts/useLazyHighlight.ts)
- Streaming affordances: a per-block rehype "fade" plugin that only wraps newly streamed characters (`createFadePlugin(hydrated)`), a `FADE_HYDRATION_THRESHOLD` so resumed content does not re-animate, and `useSmoothStreaming()` which returns false under `prefers-reduced-motion: reduce` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/Markdown.tsx), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/hooks/Messages/useSmoothStreaming.ts)
- Perf/behaviour is covered by dedicated tests and e2e scenarios: `MarkdownBlocks.bench.tsx`, `useLazyHighlight.throttle.spec.tsx`, `e2e/specs/mock/scenarios/highlight-throttle.spec.ts`, `streaming-markdown-blocks.spec.ts` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownBlocks.bench.tsx)

**assistant-ui — smooth reveal + opt-in `useDeferredValue`, memo at two levels**
- `MarkdownTextPrimitive` reveals text through `INTERNAL.useSmooth(messagePartText, smooth)`; `smooth` defaults to `true` and "Auto-disables under `prefers-reduced-motion: reduce`" — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/primitives/MarkdownText.tsx)
- `defer` (default `false`) routes rendering through a separate `DeferredMarkdownRenderer` that calls `useDeferredValue(text)`, "so urgent work (typing, scrolling) is not blocked by re-parsing the growing message on every streamed token. Intermediate streaming states may be skipped under load; the final text always renders" — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/primitives/MarkdownText.tsx)
- The renderer is `memo`ised on the rationale that "react-markdown builds a fresh processor and parses the whole accumulated text on every render"; `useStableProps`/`useStableValue` structurally compare one-to-three levels so an inline `remarkPlugins={[remarkGfm]}` or inline `components={{…}}` does not break the memo — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/primitives/MarkdownText.tsx)
- `memoizeMarkdownComponents()` wraps every component override in `memo` with `memoCompareNodes`, which deeply compares hast `properties` and `children` while skipping `position` and `data` — the public escape hatch for per-node bail-out — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/memoization.tsx)
- Unterminated fences are handled *outside* the react-markdown package: `@assistant-ui/react-streamdown` depends on `remend: ^1.4.0` (with `remend.bench.ts` / `remend.test.ts` in that package) — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/package.json)
- A separate `preprocess` hook exists specifically for streaming rewrites: `rewriteLatexBracketDelimiters`, `rewriteCustomMathTags`, `normalizeMathDelimiters`, `escapeCurrencyDollars`; the docs note the preprocess runs on the *revealed* prefix "because a preprocess rewrite fires on a closing token" — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/preprocess.ts)

**LobeChat / lobe-ui — content cache + memoised blocks + streamdown smoothing**
- `useMarkdownContent` memoises the preprocessed string in a bounded 50-entry `Map` keyed by `${children}|${enableLatex}|${enableCustomFootnotes}|${citationsLength}`, evicting oldest — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownContent.ts), [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/utils.ts)
- The code-block component is `memo`ised with `(prev, next) => prevProps.children === nextProps.children`, i.e. a code block whose source string is unchanged across tokens does not re-render — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/CodeBlock.tsx)
- Chat surface streams through `@lobehub/streamdown` with `granularity` defaulting to `'char'` and `smoothing` defaulting to `'balanced'` (`streamAnimationGranularity` / `streamSmoothingPreset` context options) — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/SyntaxMarkdown/StreamdownRender.tsx)
- lobe-ui ships streaming-specific demo harnesses (`demos/streamingBench.tsx`, `demos/streamingProfiler.tsx`, `streamProfiler/StreamdownProfilerPanel.tsx`), implying the streaming path is benchmarked — [Source](https://github.com/lobehub/lobe-ui/tree/33729d46c5/src/Markdown/demos)

**Open WebUI — one lexer pass per animation frame, but synchronous re-highlight per token**
- `Markdown.svelte`: while `done === false`, updates are coalesced into a single `requestAnimationFrame` callback (`if (!pendingUpdate) { pendingUpdate = requestAnimationFrame(() => { pendingUpdate = null; parseTokens(); }) }`), with `cancelAnimationFrame` on destroy; when `done` is true it parses immediately — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown.svelte)
- `parseTokens()` short-circuits twice: `if (content === lastContent) return` and `if (processed === lastParsedContent) return` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown.svelte)
- No code-block-level throttle exists on the chat path: `CodeBlock.svelte` renders `{@html hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}` inline in the template, so every token that changes `code` re-runs highlight.js for that block — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- The only generation-guarded, async highlighting is the *document* path (`highlightDocument` → `highlightCodeBlock` → dynamic `import('shiki')` with `if (generation === highlightGeneration)`), used when `markdown?.document` is true (file viewer), not for chat — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- Unterminated fences: mermaid/vega are only rendered once the fence is closed — `(token?.raw ?? '').slice(-4).includes('```')` — otherwise the raw source is shown — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- Non-standard streaming constructs get their own extensions: `colon-fence-extension` (`:::details`-style), `footnote-extension`, `mention-extension`, and a `ConsecutiveDetailsGroup` that collapses consecutive `tool_calls`/`reasoning`/`code_interpreter` detail blocks — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte)

**Chatbot UI — worst case, kept for contrast**
- The `code` override passes `key={Math.random()}` to `MessageCodeBlock`, forcing a full unmount/remount (and full Prism re-tokenise) on every render, i.e. every streamed token — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx)
- The only optimisation is `memo(ReactMarkdown, (prev, next) => prev.children === next.children && prev.className === next.className)` — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown-memoized.tsx)
- It also carries a hand-rolled streaming cursor hack: if the first child is the string `"▍"` it renders `<span className="animate-pulse">▍</span>` — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx)

### Inferences
- LibreChat is the only system here that treats "how much of the message still needs re-parsing" as a real data-structure problem (prefix-summed block indices + incremental splitter with a deliberate 2-block reparse tail). That is directly transferable to a `react-markdown@10` renderer regardless of plugin set.
- assistant-ui's memoisation strategy is the cheapest to adopt if we do not want to own a splitter: `memo` + structural prop comparison + `memoizeMarkdownComponents` gets most of the win for a message that grows by appending, because unchanged hast subtrees bail out.
- The 300 ms highlight throttle is a strong, citable default: it keeps the code block readable as plain text during the burst, avoids the raw↔highlighted flicker, and caps highlight work at ~3 Hz instead of per token.

### Gaps
- Whether LibreChat splits *messages containing a long code fence* into a single block (a fence is one mdast node, so the whole fence is one block and therefore re-parses each token) was not verified against the bench output.
- assistant-ui's `react-markdown` package does not mop up unterminated fences itself; I confirmed `remend` is a dependency of the *streamdown* sibling but did not read `remend`'s algorithm, so I cannot state what it does to an open fence (close it, hide it, or leave it).
- LobeChat's per-token cost inside `@lobehub/streamdown` (does Shiki re-run per token?) was not inspected — that is inside a third package.
- Open WebUI's `requestAnimationFrame` throttle bounds *parse* frequency but I found no evidence bounding highlight frequency; measurable jank on long code blocks is likely but unproven here.

---

## 3. Code blocks: highlighter, copy, language chip, line numbers, collapse, wrap, diff

### Takeaway
The convergent feature set is: language label + copy button + download/run affordances in a header bar, collapse for long blocks, and a horizontal-scroll `<pre>`. Only Open WebUI ships diff rendering, CSV table export and an editable code editor; only LobeChat special-cases single-line code and full-HTML documents; **nobody in this set ships line numbers or a word-wrap toggle in the chat code block**.

### Cited Findings

**LibreChat**
- Highlighting is `rehype-highlight` (`lowlight`) with `detect: false`, `ignoreMissing: true` and a `langSubset` allowlist, so unknown languages fall through to plain text instead of throwing — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- `client/src/components/Messages/Content/CodeBlock.tsx`: header `CodeBar`, body `<code className={`hljs language-${language} !whitespace-pre`}>` inside `overflow-y-auto p-4`, container `dir="ltr"`, plus a `FloatingCodeBar` that reappears when the real bar scrolls out of view (driven by an `IntersectionObserver`) — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Messages/Content/CodeBlock.tsx)
- `CodeBar.tsx` renders `LangIcon` + the raw language string on the left, and on the right: `RunCode` (only with `RUN_CODE` permission), `DownloadButton`, `CopyButton` — all with `iconOnly` and localized `label` props; a `plugin` block instead shows an info icon — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Messages/Content/CodeBar.tsx)
- Non-code payloads (tool/plugin output, errors) are forced to `'json'` and `!whitespace-pre-wrap`, i.e. wrap is a mode switch, not a user toggle — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Messages/Content/CodeBlock.tsx)
- Executable-block indices are propagated per message part via `CodeBlockProvider`/`CodeBlockContext` (`client/src/Providers/CodeBlockContext.tsx`) so run/download buttons map back to the right tool call — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/Providers/CodeBlockContext.tsx)
- `mermaid` and `math` fences bypass the code block entirely and route to dedicated renderers — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx)

**Open WebUI — the widest feature set**
- Chat code blocks: `highlight.js` ^11.9.0 with `highlight.js/styles/github-dark.min.css` imported directly; `{@html hljs.highlight(...)}` inside `<pre class="hljs p-4 px-5 overflow-x-auto">` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- Toolbar (sticky header) contains: language chip with tooltip, `Collapse`/`Expand` toggle (collapsed state shows "{{COUNT}} hidden lines"), `Run` for python/py or heuristic Python detection, `Save`, `Copy`/`Copied`, `Preview` for `html`/`svg`, and an `Edit`/`Done` toggle when `lang` is `diff`/`patch` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- Diff rendering is real: `isDiff = ['diff','patch'].includes(lang.trim().toLowerCase())` renders `<DiffBlock code={_code} />` instead of the highlighter — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- Editable code is a `CodeEditor` component (`readOnly={!edit}`, `ariaLabel={i18n.t('Code Editor')}`), and execution output is appended in a separate STDOUT/STDERR + RESULT panel with image outputs — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- A second, dual-theme Shiki path exists for documents/code files: `highlightCodeBlock()` dynamically imports `shiki` and calls `codeToHtml(code, { lang, themes: { light: 'github-light', dark: 'github-dark' } })`, with dark mode applied via `--shiki-dark` CSS variables — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/utils/codeHighlight.ts)
- Tables get a hover toolbar with "Copy" (copies `token.raw`, i.e. the markdown table) and "Export to CSV" (hand-rolled CSV with UTF-8 BOM) — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte)

**LobeChat / lobe-ui**
- `CodeBlock.tsx` orchestrates five paths: mermaid fence → `PreMermaid`; full HTML document → `PreHtmlPreview` (explicitly *not* HTML fragments: "Fragments fall through to the normal highlighter — inline-rendering a `<div>` snippet … risks hiding the actual code"); single-line + no `highlight` prop → `PreSingleLine`; otherwise `Pre` with `fullFeatured` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/CodeBlock.tsx)
- "Single line" is defined as `countLines(content) <= 1 && content.length <= 32` — a small but effective anti-noise heuristic — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/CodeBlock.tsx)
- `@lobehub/ui`'s `<Markdown variant="chat">` is configured with `highlight: { fullFeatured: true, theme }`, and chat context passes `mermaid: { fullFeatured: false }` — i.e. full-featured code chrome in chat, reduced mermaid chrome — [Source](https://github.com/lobehub/lobe-chat/blob/3f6ccbab65/src/features/Conversation/Markdown/index.tsx)

**assistant-ui**
- `DefaultCodeBlock` is intentionally thin: `<CodeHeader language={language} code={code} />` followed by `<SyntaxHighlighter components={{Pre, Code}} language code />`; the default `SyntaxHighlighter` (`DefaultCodeBlockContent`) is a plain `pre/code` passthrough — chrome comes from the app or from `@streamdown/code` — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/overrides/CodeBlock.tsx), [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/primitives/MarkdownText.tsx)
- `componentsByLanguage` allows per-fence overrides, documented example `{ mermaid: { SyntaxHighlighter: MermaidDiagram } }` — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/code-fence.ts)
- Fence detection is deliberately split pre/code aware: `PreOverride` + `useIsMarkdownCodeBlock()` ensure only real fenced blocks become code blocks (inline code stays inline), with `parseLanguageClass(className)` → `/(?:^|\s)language-([^\s]+)/` — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/overrides/CodeOverride.tsx)
- Streamdown ships the code toolbar (copy, download, fullscreen) but requires the consumer to add `@source "../node_modules/streamdown/dist/*.js"` to Tailwind or "the copy, download, and fullscreen buttons render unstyled, and the caret indicator stays invisible" — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/README.md)

**Chatbot UI**
- `Prism as SyntaxHighlighter` from `react-syntax-highlighter` with the `oneDark` Prism theme, plus copy and download buttons (`programmingLanguages` map chooses the download extension) — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-codeblock.tsx)

### Inferences
- Line numbers and a word-wrap toggle are genuinely absent across all five; if our renderer has them, that is a differentiator, not table stakes.
- Collapse/expand for long blocks is only in Open WebUI (`collapsed` + "{{COUNT}} hidden lines") and LibreChat's non-code wrapping mode; LobeChat and assistant-ui delegate it to the "full featured"/streamdown chrome.

### Gaps
- LibreChat: I found no line-number rendering and no diff renderer in the chat code block; absence is inferred from reading `CodeBlock.tsx` + `CodeBar.tsx` only, not from an exhaustive repo search.
- The highlighter library behind `@lobehub/ui`'s `<Highlighter>` (and hence LobeChat's `fullFeatured` code blocks) was not opened.
- `@streamdown/code` internals (Shiki bundling, copy UX details) were not read; only its existence as an optional peer is verified.

---

## 4. Citations: inline pills, hover cards, sources lists, and provider formats

### Takeaway
Two mainstream approaches exist, and both are **renderer-side, protocol-agnostic**: LibreChat invents a private-use Unicode citation protocol (U+E200–U+E204) that the model is instructed to emit and that a remark plugin turns into hast nodes; LobeChat and Open WebUI both post-process plain `[n]` bracket markers into links/tokens. Nobody parses OpenAI `annotations`, Perplexity `【n】` markers, Gemini grounding metadata or Anthropic `<cite>` tags **in the markdown renderer** — that normalisation happens server-side or not at all. assistant-ui and Chatbot UI have no citation pipeline; assistant-ui only ships copy-paste citation *UI*.

### Cited Findings

**LibreChat — richest implementation, custom Unicode protocol**
- `client/src/utils/citations.ts` documents the wire format: `\ue202` standalone marker before each anchor, `\ue200`/`\ue201` composite group delimiters, `\ue203`/`\ue204` highlight-span delimiters, anchor grammar `turn{N}{search|image|news|video|ref|file}{index}`. Every regex accepts **both** the literal 6-char escape `\ue202` and the real U+E202 character, because "some models may convert them to actual Unicode characters during text generation" — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/utils/citations.ts)
- `client/src/components/Web/plugin.ts` is a remark transformer: it walks `text` nodes, finds the closest of span / composite / standalone matches, correctly disambiguates a standalone marker that sits inside a composite block, strips leftover control characters with `CLEANUP_REGEX`, and emits `citation` / `composite-citation` / `highlighted-text` nodes with stable per-position ids — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Web/plugin.ts)
- `markdownConfig.ts` maps those node types to React components: `citation: Citation`, `'composite-citation': CompositeCitation`, `'highlighted-text': HighlightedText` — so citations are first-class markdown nodes, not post-render DOM surgery — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- `Citation.tsx`: a citation is a `SourceHovercard` whose label is the attribution/title/clean-domain, showing favicon + domain + title + `line-clamp-4` snippet; a composite citation is a **pager** — prev/next buttons plus numbered pills, each with `aria-label={com_sources_number}` and `aria-current`, and it centres a small cross-component hover state (`setHoveredCitationId`) so hovering a pill can highlight the matching source — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Web/Citation.tsx)
- File citations (`refType === 'file'`) render a file icon + name button that opens `FilePreviewDialog`, and display relevance % and page numbers; `useCompositeCitations` resolves marker ids → source objects via `CitationContext` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Web/Citation.tsx)
- Sources list: `client/src/components/Web/Sources.tsx` (+ `SourcesErrorBoundary`), fed by `sources.ts` helpers — `collectSources()` dedupes across *all* search turns keyed by link (last write wins), `getUniqueDomainSources()` returns the first N distinct domains for the favicon stack — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/sources.ts)
- Server side there is a parallel citation path for file/RAG citations: `api/server/services/Files/Citations/index.js` and `packages/api/src/files/citations.ts` (+ `packages/api/src/files/citations.spec.ts`) — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/packages/api/src/files/citations.ts)

**Open WebUI — `[n]` → inline pill → modal, plus a sources footer**
- `citation-extension.ts` is a marked inline tokenizer: `start()` triggers on any `[` followed by a digit (deliberately avoiding arbitrary links), skips `[^` footnotes, matches **one or more adjacent** groups `[1][2,3][4#bar]`, and yields `{ type: 'citation', ids, citationIdentifiers }` where `#suffix` gives granular sub-source targeting — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/utils/marked/citation-extension.ts)
- Inline rendering only happens when the message actually has sources: `{#if (sourceIds ?? []).length > 0}<SourceToken … onClick={onSourceClick} />{:else}<TextToken …/>{/if}` — so a bare `[1]` in ordinary prose does not become a chip — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte)
- Clicking a chip calls `showSourceModal(sourceId)` in `Citations.svelte`, which splits `"3#foo"` into index+suffix, then either opens the in-app embed panel (`showTabs`/`showEmbeds`/`embed.set`) when `source.embed_url` is a valid http(s) URL, or opens `CitationModal` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Citations.svelte)
- The footer is a single pill: "1 Source"/"{{COUNT}} Sources" with up to three Google favicons (`https://www.google.com/s2/favicons?sz=32&domain=…`) and a `+N` counter, `aria-expanded`, and an expandable numbered list where each row has `aria-label="View source: {{name}}"` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Citations.svelte)
- It also computes whether to show relevance: distances are shown as a percentage only when every value is in `[-1, 1]` (`shouldShowPercentage`), and hidden when there is a single outlier (`calculateShowRelevance`) — a nice detail for RAG-cosine displays — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Citations.svelte)

**LobeChat — `[n]` rewritten to a markdown link, skipped inside math/code**
- `transformCitations(rawContent, length)` builds a regex over exactly `1..length`, collects matches, then **excludes** matches inside `$$…$$`, `$…$`, fenced code and inline code by computing excluded ranges, replaces from the end backwards to keep offsets valid, and rewrites `[3]` → `[#citation-3](citation-3)`; adjacent `][` becomes `] [` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/utils.ts)
- The rewritten link is then rendered by the app's `a` component: `useMarkdownComponents` passes the citation list into `<Link citations={citations} {...props} />` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownComponents.tsx)
- Only runs when `enableCustomFootnotes` is set, and the cache key includes `citationsLength` so growing citation arrays invalidate the memoised string — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownContent.ts)

**assistant-ui — UI elements only, no parsing**
- The inline-citation demo composes `<InlineCitation>` with `<Citation index source open onOpenChange />` imported from `@/components/assistant-ui/elements/inline-citation` — a shadcn-style registry component copied into the app, not a runtime package export — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/apps/docs/components/demo/elements/inline-citation.tsx)
- A sibling `SourcesDemo` exists in `apps/docs/components/demo/elements/sources.tsx`; both are documentation "Elements", and the core packages expose no citation primitive or annotation parser — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/apps/docs/components/demo/elements/sources.tsx)

**Chatbot UI** — no citation support of any kind; the markdown `components` map only overrides `p`, `img`, `code` — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx)

### Inferences
- The `[n]` bracket → token → click → modal pipeline (LobeChat/Open WebUI) is far cheaper to implement than LibreChat's Unicode protocol, but it inherits two failure modes both projects had to patch: collisions with markdown links/footnotes, and citations inside code/math (LobeChat solves it with range exclusion; Open WebUI solves it with a `[^` guard and a `[digit` trigger).
- LibreChat's private-use codepoints are the more robust design *if* you control the system prompt, because they cannot be confused with markdown syntax at all; the cost is a backend instruction contract and a bespoke remark transformer.
- Supporting OpenAI annotations / Perplexity `【n】` / Gemini grounding would require a normalisation layer *before* markdown in every one of these systems; none of them demonstrate that layer in the renderer.

### Gaps
- I did not verify LibreChat's `Sources.tsx` render logic or `SourceHovercard` internals (only `Citation.tsx`, `sources.ts`, `plugin.ts`, `citations.ts`), so hover-card behaviour details (portal, delay, keyboard focus) are unconfirmed.
- No evidence found in any of the five that the *renderer* natively parses OpenAI `annotations[]`, Perplexity `【n】`, or Gemini `groundingMetadata`; absence is asserted from the pipeline files I read, not from an exhaustive search.
- LobeChat's `Link`/citation chip component (`@/mdx/mdxComponents/Link`) was not opened, so the pill styling/hover behaviour is unverified.

---

## 5. Math (KaTeX/MathJax) and Mermaid, and whether they are lazy

### Takeaway
KaTeX is universal and statically bundled (no MathJax anywhere); Mermaid is universally lazy and universally wrapped in an error boundary, because Mermaid output is the most likely thing to throw mid-stream. Only LibreChat and Open WebUI render non-Mermaid diagrams (Vega) or pan/zoom.

### Cited Findings
- **LibreChat**: `remark-math` + `rehype-katex` in the plugin chain, plus `katex/contrib/mhchem`; single-dollar math is a user setting while `$$`, `\(…\)`, `\[…\]` always parse via the `micromark-extension-llm-math` alias — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts). Mermaid lives in `client/src/components/Messages/Content/Mermaid/*` (`Mermaid.tsx`, `MermaidDialog.tsx`, `MermaidErrorBoundary.tsx`, `MermaidHeader.tsx`, `ZoomControls.tsx`, `useSvgProcessing.ts`) with `client/src/hooks/Mermaid/useDebouncedMermaid.ts` and `useMermaid.ts`; there is a dedicated e2e scenario named `lazy-mermaid.spec.ts`, and the code component renders `<MermaidErrorBoundary code={content}><Mermaid id={`mermaid-${mermaidIndex}`}>` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/hooks/Mermaid/useDebouncedMermaid.ts)
- **Open WebUI**: `marked-katex-extension` → `inlineKatex` / display tokens → `KatexRenderer.svelte` with `displayMode`; Mermaid is `await initMermaid()` (dynamic) and rendered inside `SvgPanZoom` (panzoom ^9.4.3); `vega`/`vega-lite` fences render through `renderVegaVisualization`, and both diagram paths only run once the fence is closed and are guarded by `renderError` state — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte)
- **LobeChat**: `remarkMath` + custom `rehypeKatex`/`rehypeKatexDir` (the latter supplies per-formula `dir` for RTL), gated by `enableLatex`; `katex` is a peer dep; Mermaid is `PreMermaid` with `fullFeatured: false` and a user-chosen `mermaidTheme` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts), [Source](https://github.com/lobehub/lobe-chat/blob/3f6ccbab65/src/features/Conversation/Markdown/index.tsx)
- **assistant-ui**: math and mermaid are *optional peer packages* — `@streamdown/math` and `@streamdown/mermaid` — installed only if used, and the app must import `katex/dist/katex.min.css` itself; this is the only system here where math is opt-in per install — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/package.json), [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/README.md)
- **Chatbot UI**: `remark-math` is in `remarkPlugins` but there is **no** `rehype-katex` and no math component override, so math nodes are parsed and then render as nothing — a concrete example of a half-wired math stack — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx), [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/package.json)

### Inferences
- KaTeX being static while Mermaid is dynamic is the right split: KaTeX is ~270 KB of CSS+fonts but synchronous and fast; Mermaid is megabytes and slow. Any lazy-loading strategy should mirror this asymmetry rather than code-splitting both.
- The "only render the diagram when the fence is closed" guard (Open WebUI, and LibreChat's `useDebouncedMermaid`) is the minimum viable defence against re-running a 200 ms Mermaid layout on every token.

### Gaps
- I did not open LibreChat's `Mermaid.tsx`/`useDebouncedMermaid.ts` bodies, so the debounce interval and whether the Mermaid module is `import()`-ed (vs merely mounted late) are unconfirmed; the `lazy-mermaid` e2e spec is strong but indirect evidence.
- LobeChat's `@lobehub/ui` Mermaid component internals (lazy? worker?) were not inspected.

---

## 6. Sanitisation and raw HTML from the model

### Takeaway
The safest and most common choice is **to not enable raw HTML at all** (LibreChat, assistant-ui's react-markdown path, Chatbot UI). Where raw HTML is a product requirement, both projects that allow it stack permissive parsing with a sanitiser: LobeChat uses `rehype-raw` → `rehype-sanitize`; Open WebUI runs DOMPurify on every HTML token. assistant-ui's streamdown path is the only one using three layers (`rehype-raw` + `rehype-sanitize` + `rehype-harden`).

### Cited Findings
- **LibreChat**: `rehypeRaw` is *not* in the rehype chain — only `[rehypeKatex]` and `[rehypeHighlight, …]` — and the splitter documents the consequence: "top-level raw HTML blocks are escaped to text (rehypeRaw is not enabled), so the separator between adjacent HTML blocks would otherwise be dropped". `dompurify: ^3.4.17` is a client dependency but is not part of the markdown pipeline — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/packages/chat/src/core/parts/splitMarkdown.ts), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/package.json)
- **LobeChat / lobe-ui**: rehype order is explicitly `rehypeRaw` then `rehypeSanitize`, with the inline comment "Parse untrusted HTML into nodes, then remove unsafe elements and attributes", both gated on an `allowHtml` flag; when `allowHtml` is off they instead install `remarkBr`, `remarkGfmPlus` and `remarkVideo` to keep the common authoring conveniences — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts), [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRemarkPlugins.ts)
- **Open WebUI**: DOMPurify is applied at every HTML entry point — `HtmlToken.svelte` (`html = text ? DOMPurify.sanitize(text) : null`), the inline path (`inlineHtml = … DOMPurify.sanitize(markdown.parseInline?.(tokens) ?? '')`, with a comment explaining that paired inline tags must be sanitised together), and footnote rendering (`DOMPurify.sanitize(`<sup …>`)`) — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/HTMLToken.svelte), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte)
- Open WebUI additionally has *policy* switches, not just sanitisation: `allowHtml` and `allowRemoteContent` props cause `marked.walkTokens` to rewrite disallowed tokens to plain `text` and to delete their children "so blocked content cannot render through a nested renderer"; `<iframe>` embeds get a configurable `sandbox` allow-list (`allow-scripts`, `allow-downloads`, `allow-forms`, `allow-same-origin`) and a `referrerpolicy` — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown.svelte), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/HTMLToken.svelte)
- **assistant-ui**: the base `react-markdown` integration adds no raw-HTML handling (react-markdown's default is to drop raw HTML); the streamdown integration pulls in `rehype-raw`, `rehype-sanitize` **and** `rehype-harden`, and has a dedicated `StreamdownTextSanitizeFallback.test.tsx` — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/package.json), [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-streamdown/src/__tests__/StreamdownTextSanitizeFallback.test.tsx)
- **Chatbot UI**: no sanitiser, no `rehype-raw`; raw HTML is simply dropped by react-markdown — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-markdown.tsx)

### Inferences
- If our renderer currently has no `rehype-raw`, we are in the LibreChat/assistant-ui majority and the correct framing is "raw HTML is escaped, not sanitised" — worth stating explicitly in docs so nobody assumes DOMPurify is running.
- LobeChat's ordering (`raw` → `sanitize`) and assistant-ui's triple layer (`raw` → `sanitize` → `harden`) are the two reference configurations if HTML support is ever required.

### Gaps
- Where LibreChat actually uses its `dompurify` dependency (artifacts? MCP UI resources?) was not traced.
- LobeChat uses `rehype-sanitize` with the default schema — I did not confirm whether they pass a custom `Schema` (e.g. to keep `className` for syntax highlighting). This matters: the default schema strips `className`, which would break highlight classes.
- `rehype-harden`'s exact guarantees were not read.

---

## 7. Accessibility: `dir`, `lang`, aria labels, keyboard access

### Takeaway
Bidirectional text handling is the sharpest differentiator and only two projects do it seriously: LibreChat computes direction from *content* (not just first character) for containers and tables, and LobeChat has a dedicated `rehypeKatexDir` for formulas. Open WebUI sprinkles `dir="auto"` on block elements. Nobody sets `lang` on message containers; aria labelling of copy buttons is good in LibreChat, mixed in Open WebUI, and absent in Chatbot UI.

### Cited Findings
- **LibreChat**: `p` renders `<p dir="auto">`; `h1`–`h6` are `withAutoDir(Tag)`; `ul`/`ol`/`blockquote` use `withContentDir`, which walks the hast subtree with `strongDirection()` (skipping `code`/`pre`) because "the browser's `dir="auto"` skips paragraphs that carry their own `dir`, so a container would resolve to LTR whatever its text"; `table` wraps in `<div dir={dir} className="markdown-table-wrapper w-full max-w-full">` with one direction for the whole table "so cell borders and corners stay on a single frame"; the code body is explicitly `dir="ltr"` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Messages/Content/CodeBlock.tsx)
- LibreChat copy/download affordances take a `label` prop (`localize('com_ui_copy_code')`, `com_ui_download_code`) with `iconOnly`, so the button is icon-only but labelled; citation pager buttons carry `aria-label` + `aria-current`; decorative icons are `aria-hidden="true"` — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Messages/Content/CodeBar.tsx), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Web/Citation.tsx)
- **Open WebUI**: `dir="auto"` on headings, `<table>`, `<ol>`, `<ul>`, `<li>`, `<blockquote>`; task-list checkboxes use `aria-labelledby` pointing at the `<li>` id; the sources toggle has `aria-label` + `aria-expanded`; each source row has `aria-label="View source: …"`; table copy/CSV buttons have `aria-label`; the code-block Copy button has **no** `aria-label` (text label only) and the language chip is `<span>` inside a tooltip — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Citations.svelte), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/CodeBlock.svelte)
- **LobeChat**: `rehypeKatexDir` exists specifically to give KaTeX output a direction, and `hastTableToMarkdown` powers the table copy button's `title="Copy table"` — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts), [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/MarkdownTable/index.tsx)
- **assistant-ui**: the container `<div>` carries `data-status={status.type}` from `useSmoothStatus()` so CSS/consumers can react to `streaming` vs `done`; no `dir`/`lang` handling is built in — direction is the consumer's responsibility — [Source](https://github.com/assistant-ui/assistant-ui/blob/21f88ceebb/packages/react-markdown/src/primitives/MarkdownText.tsx)
- **Chatbot UI**: no `dir`, no `lang`, no aria labels on the code copy/download buttons — [Source](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2/components/messages/message-codeblock.tsx)

### Inferences
- LibreChat's `strongDirection` + subtree walk is the only correct solution here for mixed-language replies; `dir="auto"` on a `<ul>` alone is a no-op when its `<li>`s already carry `dir`, which is exactly the bug their comment documents.
- `data-status` on the scroll container (assistant-ui) is a cheap, testable hook for aria-live/cursor CSS and is worth copying.

### Gaps
- No project was observed setting `lang` on message content, and none announced a `aria-live` region for streaming text; I did not check whether streaming announcements happen at a higher level (e.g. a message list component).
- I did not verify LibreChat's `CopyButton` implementation inside `@librechat/chat/components` (only that a localized `label` is passed).

---

## 8. Things we might be missing: table wrappers, link handling, file paths, clipboard semantics

### Takeaway
The recurring "small wins" are: a scroll wrapper plus a copy affordance on tables, authenticated download interception for model-emitted file paths, allowlisted link protocols, and a clipboard mode that chooses between markdown and plain text. LibreChat and Open WebUI each implement a different half of that list, and LobeChat is the only one that copies a table *as markdown*.

### Cited Findings
- **Table scroll wrapper**: LibreChat `markdown-table-wrapper` + `w-full max-w-full` (with a single computed `dir`); Open WebUI `relative w-full group` → `overflow-x-auto max-w-full scrollbar-hidden`; LobeChat `lobe-markdown-table` styled wrapper with an absolutely-positioned copy button; assistant-ui and Chatbot UI ship none by default — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte), [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/MarkdownTable/index.tsx)
- **Copy table as markdown**: lobe-ui serialises the hast table back to markdown via `hastTableToMarkdown(node)` and passes a *function* as `content` to `CopyButton`, so the markdown is computed lazily on click — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/MarkdownTable/index.tsx), [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/Markdown/components/MarkdownTable/hastTableToMarkdown.ts)
- **Clipboard markdown-vs-plain**: Open WebUI routes copies through `copyToClipboard(text, null, $settings?.copyFormatted ?? false)` — a user setting that toggles "formatted" (rich/markdown) vs plain text — and the table copy passes `token.raw` (raw markdown) rather than rendered text — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte)
- **File-path links → authenticated download**: LibreChat's `a` component regex-matches `(?:files|outputs)/${userId}/([^\s]+)`, and if it matches turns the anchor into a click handler that calls `useFileDownload()` and `triggerDownload(stream.data, filename)` instead of navigating; otherwise it is a plain `target="_blank"` link — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx)
- **Image path resolution**: LibreChat's `img` resolves model-written relative names (`![DTI](5_dti.png)`) against the turn's attachments via `resolveInlineMedia(src, attachmentsByName)` then `toAbsoluteFilePath(resolved, baseURL)`, so generated charts render instead of a broken-image glyph — [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/MarkdownComponents.tsx)
- **Link protocol allowlist + internal navigation**: Open WebUI links go through `safeLinkUrl(href)`, get `rel="nofollow"` + `target="_blank"`, and same-origin `/notes/:id`, `/c/:id`, `/channels/:id` URLs are intercepted to `goto()` for in-app SPA navigation (with a dedicated `NoteLinkToken`) — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte)
- **File-link plugin family (LobeChat)**: `src/features/Conversation/Markdown/plugins/` contains `FileLink`, `LocalFileLink`, `LocalFile`, `ImageSearchRef`, `ReferDocument`, `ReferTopic`, `LobeArtifact`, `LobeThinking`, `Task`, `Tool`, `Skill`, `ScmEvent`, `UserFeedback`, `GoalTurn`, `Mention` — each with an `index.ts` (rehype plugin) + `Render.tsx`, i.e. a plug-in architecture where every model-emitted non-markdown construct is a first-class node with its own renderer — [Source](https://github.com/lobehub/lobe-chat/tree/3f6ccbab65/src/features/Conversation/Markdown/plugins)
- **Streaming details grouping (Open WebUI)**: consecutive `details` tokens of type `tool_calls`/`reasoning`/`code_interpreter` are collapsed into a single `detail_group` display token, and hidden `tool_calls` with terminal status are dropped entirely — a pattern for keeping long agent traces out of the reading flow — [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte)
- **Alerts / directives**: LobeChat uses `rehype-github-alerts`; Open WebUI has `AlertRenderer.svelte` for blockquote alerts plus a `colon-fence-extension` for `:::details`; LibreChat uses `remark-directive` for `:::artifact` containers — three different solutions to the same "GFM doesn't have callouts" problem — [Source](https://github.com/lobehub/lobe-ui/blob/33729d46c5/src/hooks/useMarkdown/useMarkdownRehypePlugins.ts), [Source](https://github.com/open-webui/open-webui/blob/b0e6098e94/src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte), [Source](https://github.com/danny-avila/LibreChat/blob/e6567c7a68/client/src/components/Chat/Messages/Content/markdownConfig.ts)
- **Newer incremental engine in assistant-ui**: `packages/markdown/src/` exists as a standalone core (`session.ts`, `complete.ts`, `tokenizer/markdown-it.ts`, `plain-text.ts`, plus `react/`, `vue/`, `react-native/`, `ink/` adapters and a `session.bench.ts`), suggesting a move toward an incremental, framework-agnostic parse session — [Source](https://github.com/assistant-ui/assistant-ui/tree/21f88ceebb/packages/markdown/src)

### Inferences
- The highest-leverage items we are likely missing, ranked by (impact ÷ effort): table scroll wrapper + copy-as-markdown; authenticated interception of model-emitted file paths; `dir` computed from subtree content rather than `dir="auto"` on containers; a 250–300 ms highlight throttle; a clipboard mode switch (markdown vs plain).
- LobeChat's "one plugin directory per non-markdown construct, each exporting `index.ts` + `Render.tsx`" is the cleanest extensibility model of the five and maps well onto `react-markdown`'s `components` + custom remark/rehype plugins.

### Gaps
- External-link favicons / link preview cards: only Open WebUI has favicons, and only for *citation* sources (Google s2 favicon service), not for inline links; no project showed an inline link preview card, so its absence across all five is asserted from the files read rather than proven.
- Whether LibreChat's `Sources.tsx` renders a collapsed rail vs a list (there are e2e specs named `source-rails.spec.ts` and `source-chip.spec.ts` hinting at both) was not verified.
- Keyboard access for hover cards (Escape to close, focus trap in `MermaidDialog`/`CitationModal`) was not verified in any project.
