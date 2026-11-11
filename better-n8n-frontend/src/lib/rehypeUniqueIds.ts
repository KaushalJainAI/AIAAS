/**
 * Makes a message's footnote ids unique to that message.
 *
 * `remark-gfm` numbers footnotes per document: the first one is
 * `user-content-fn-1`, its backlink `user-content-fnref-1`, and the section
 * heading `footnote-label`. A transcript is many documents rendered into one
 * page, so every footnoted answer after the first reuses those ids. The
 * duplicate `id`s are invalid HTML, and worse, clicking `[1]` in the second
 * message jumps to the **first** message's definition — the browser resolves a
 * fragment to the first match in the document.
 *
 * Prefixing with an id from the component (`useId`) scopes them per message.
 * Nothing renders `~` differently: this changes attributes only, after the
 * markdown has been parsed and converted to HTML.
 */

interface HastProperty {
  [key: string]: unknown;
}

interface HastNode {
  type: string;
  tagName?: string;
  properties?: HastProperty;
  children?: HastNode[];
}

/** Attributes whose value names an element in the same document. */
const ID_ATTRIBUTES = ['id', 'aria-describedby', 'aria-labelledby'] as const;

/** The ids `remark-gfm` gives footnotes, and the section's label. */
function scoped(value: string, prefix: string): string {
  if (value === 'footnote-label' || value.startsWith('user-content-')) {
    return `${prefix}-${value}`;
  }
  return value;
}

function visit(node: HastNode, prefix: string): void {
  const properties = node.properties;

  if (properties) {
    for (const attribute of ID_ATTRIBUTES) {
      const value = properties[attribute];
      if (typeof value === 'string') {
        // `aria-*` holds a space-separated list; `id` holds one value.
        properties[attribute] = value
          .split(' ')
          .map((part) => scoped(part, prefix))
          .join(' ');
      }
    }

    const href = properties.href;
    if (typeof href === 'string' && href.startsWith('#user-content-')) {
      properties.href = `#${prefix}-${href.slice(1)}`;
    }
  }

  for (const child of node.children ?? []) visit(child, prefix);
}

/** The plugin. `prefix` must be unique per rendered message and stable across renders. */
export interface UniqueIdsOptions {
  prefix: string;
}

export function rehypeUniqueIds(options: UniqueIdsOptions) {
  const prefix = String(options?.prefix || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return (tree: HastNode): void => {
    if (prefix) visit(tree, prefix);
  };
}
