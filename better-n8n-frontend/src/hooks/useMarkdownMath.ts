/**
 * KaTeX, loaded the first time a message actually contains maths.
 *
 * KaTeX is ~280 kB and the chat renders on every page, so it must not be in
 * the main bundle. `LatexPreview` already lazy-loads it for `.tex` files; this
 * does the same for model output, and adds `remark-math`/`rehype-katex` only
 * once there is a delimiter to parse — the same "plain first, colour when it
 * arrives" shape `CodeView` uses for highlighting.
 *
 * It is also off while a message is streaming. Re-tokenising maths on every
 * delta was the top cost in Open WebUI's profile of a long answer, and a
 * half-received `$$` block renders as noise anyway; maths appears when the
 * message settles.
 */

import { useEffect, useState } from 'react';
import type { Pluggable } from 'unified';

type MathPipeline = {
  /** `remark-math`, once its chunk has loaded. */
  remark: Pluggable[];
  /** `rehype-katex`, once its chunk has loaded. */
  rehype: Pluggable[];
};

let loaded: MathPipeline | null = null;
let loading: Promise<MathPipeline> | null = null;

function loadMath(): Promise<MathPipeline> {
  loading ??= Promise.all([
    import('remark-math'),
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([remarkMath, rehypeKatex]) => {
    loaded = {
      remark: [remarkMath.default],
      // `throwOnError: false` keeps a malformed formula as red text instead of
      // taking the whole answer down with it.
      rehype: [[rehypeKatex.default, { throwOnError: false }]],
    };
    return loaded;
  });

  return loading;
}

/** The maths plugins, or empty lists until the chunk has loaded. */
export function useMarkdownMath(enabled: boolean): MathPipeline {
  const [pipeline, setPipeline] = useState<MathPipeline>(() => loaded ?? { remark: [], rehype: [] });

  useEffect(() => {
    if (!enabled || loaded) return;

    let cancelled = false;
    loadMath()
      .then((value) => {
        if (!cancelled) setPipeline(value);
      })
      .catch(() => {
        // A failed chunk load leaves the delimiters as plain text, which is
        // still readable. Nothing to report: the message is not broken.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return pipeline;
}
