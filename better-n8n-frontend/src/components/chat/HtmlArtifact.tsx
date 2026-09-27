import { useMemo, useState } from 'react';
import { Code2, Maximize2, Minimize2 } from 'lucide-react';
import type { HtmlArtifact as HtmlArtifactData } from '../../api/chat';

/**
 * Renders a model-authored HTML/CSS/JS snippet.
 *
 * Everything about this component is a containment boundary, so the reasoning is
 * worth stating explicitly:
 *
 * - `srcDoc` + `sandbox`, never `dangerouslySetInnerHTML`. Injecting into our own
 *   DOM would run model-authored script in our origin, where it can read the
 *   access token out of localStorage. The iframe gets a null origin instead.
 *
 * - The sandbox list has no `allow-same-origin`. That is the single flag that
 *   matters: with it, `allow-scripts` lets the frame reach back into our origin
 *   and the sandbox is decorative. Without it the frame cannot touch our storage,
 *   cookies, or DOM.
 *
 * - Dimensions are clamped again here even though the server clamps on write. A
 *   stored artifact is replayed on every reload, so one bad value written before
 *   a limit changed would otherwise misrender forever.
 */

// Kept in sync with workflow_backend/thresholds.py. Duplicated deliberately: the
// server bound protects what gets stored, this one protects what gets rendered,
// and neither should depend on the other being correct.
const MAX_WIDTH = 720;
const MAX_HEIGHT = 520;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;

const clamp = (value: number, lo: number, hi: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(lo, Math.min(hi, value));
};

interface Props {
  artifact: HtmlArtifactData;
}

export default function HtmlArtifact({ artifact }: Props) {
  const [showSource, setShowSource] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const width = clamp(Number(artifact.width), MIN_WIDTH, MAX_WIDTH, 640);
  const height = clamp(Number(artifact.height), MIN_HEIGHT, MAX_HEIGHT, 360);

  // A frame with no styling of its own inherits nothing and renders as an
  // unstyled white box against a dark chat. Give it a readable baseline that the
  // artifact's own CSS can still override.
  const srcDoc = useMemo(() => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body {
        margin: 0;
        padding: 12px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #e7e9ee;
        background: transparent;
        overflow: auto;
      }
      a { color: #7aa2f7; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #3a3f4b; padding: 4px 8px; }
      img, svg, canvas { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>${artifact.html}</body>
</html>`, [artifact.html]);

  return (
    <div
      className="group/artifact my-3 overflow-hidden rounded-lg border border-border bg-card
                 animate-in fade-in slide-in-from-bottom-2 duration-500
                 transition-shadow hover:shadow-lg hover:shadow-primary/5"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/70" />
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          {artifact.title || 'Rendered output'}
        </span>
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/artifact:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setShowSource(s => !s)}
            aria-pressed={showSource}
            title={showSource ? 'Show rendered output' : 'Show HTML source'}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Code2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-pressed={expanded}
            title={expanded ? 'Shrink' : 'Expand to full width'}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {expanded
              ? <Minimize2 className="h-3.5 w-3.5" />
              : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {showSource ? (
        <pre
          className="m-0 max-h-[520px] overflow-auto bg-background/60 p-3 text-[11px] leading-relaxed
                     text-muted-foreground animate-in fade-in duration-200"
        >
          <code>{artifact.html}</code>
        </pre>
      ) : (
        <iframe
          // Deliberately omits allow-same-origin: with it, allow-scripts would
          // give the frame access to our origin and the sandbox would be
          // meaningless. Omitting it also blocks network access from the frame.
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={artifact.title || 'Rendered output'}
          loading="lazy"
          // Expanding relaxes the width to the bubble, never past MAX_HEIGHT —
          // an artifact must not be able to push the composer off screen.
          style={{
            width: expanded ? '100%' : `${width}px`,
            maxWidth: '100%',
            height: `${height}px`,
            maxHeight: `${MAX_HEIGHT}px`,
          }}
          className="block border-0 bg-transparent transition-[width,height] duration-300 ease-out"
        />
      )}
    </div>
  );
}
