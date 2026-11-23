/**
 * The document an HTML artifact is drawn from. The chat's own frame and the
 * side pane's copy both build it here, so they cannot drift apart.
 *
 * The frame that shows it is always `sandbox="allow-scripts"` with no
 * `allow-same-origin`: the model wrote this markup, so it gets a null origin
 * and no route into our storage or DOM.
 */

/** The sandbox list every artifact frame uses. Never add allow-same-origin. */
export const ARTIFACT_SANDBOX = 'allow-scripts';

/** Gives a bare frame a readable baseline the artifact's own CSS can override. */
export function artifactSrcDoc(html: string): string {
  return `<!DOCTYPE html>
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
  <body>${html}</body>
</html>`;
}
