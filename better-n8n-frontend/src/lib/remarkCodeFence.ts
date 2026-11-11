/**
 * Gives every fenced block a language class, including the ones that have none.
 *
 * react-markdown v10 removed the `inline` prop from the `code` renderer, so the
 * only thing left to tell a block from a code span is the `language-…` class
 * that `remark-rehype` adds when a fence carries an info string. A model that
 * writes
 *
 *     ```
 *     plain output
 *     ```
 *
 * therefore produced a `<code>` with no class, the renderer took the inline
 * branch, and the block lost its copy button and header — it rendered as a chip
 * inside a `<pre>`. Bare fences are common (logs, diagrams, ANSI output), so
 * that is not a rare path.
 *
 * The mdast `code` node is exactly "a fenced or indented block": `inlineCode`
 * is a different node type. Tagging the block here is therefore structural, not
 * a heuristic over the source text. `text` is the honest label for a block that
 * did not say what it is — `languageFor('text')` is null, so it renders
 * unhighlighted.
 */

interface CodeNode {
  type: string;
  lang?: string | null;
  data?: Record<string, unknown>;
  children?: CodeNode[];
}

/** Some models write a fence tag that is a sentence; keep it class-safe. */
function safeTag(lang: string | null | undefined): string {
  const cleaned = (lang || '').trim().toLowerCase().replace(/[^\w+#.-]/g, '');
  return cleaned || 'text';
}

function tag(node: CodeNode): void {
  if (node.type === 'code') {
    const properties = (node.data?.hProperties as Record<string, unknown> | undefined) ?? {};
    node.data = {
      ...node.data,
      hProperties: { ...properties, className: [`language-${safeTag(node.lang)}`] },
    };
  }

  for (const child of node.children ?? []) tag(child);
}

/** The plugin. Takes no options; a fence tag is already on the node. */
export function remarkCodeFence() {
  return (tree: CodeNode): void => tag(tree);
}
