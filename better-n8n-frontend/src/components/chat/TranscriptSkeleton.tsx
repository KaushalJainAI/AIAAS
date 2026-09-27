/**
 * Placeholder for a transcript still being fetched.
 *
 * Only shown on a cold cache — with a cached transcript the real thing paints
 * in the first frame and this never renders. It exists so the gap is filled by
 * something shaped like the answer that is coming, rather than by the agent's
 * thinking indicator, which used to run here and claimed the model was working
 * when the page was only issuing a GET.
 *
 * Deliberately built from the same geometry as a settled turn (question
 * heading, "Answer" label, body lines, the same 24/32px turn rhythm) so the
 * transcript replaces it in place instead of pushing it aside.
 */

import { BrainCircuit } from 'lucide-react';

/** Body lines are ragged on purpose — equal bars read as a table, not prose. */
const TURNS: number[][] = [
  [100, 92, 96, 70],
  [100, 88, 45],
];

export default function TranscriptSkeleton() {
  return (
    <div className="space-y-6 md:space-y-8 animate-pulse" aria-hidden="true">
      {TURNS.map((lines, turn) => (
        <div key={turn} className="space-y-3">
          {/* The question, which renders as a heading rather than a bubble. */}
          <div className="h-6 w-2/3 rounded bg-muted" />

          <div className="flex items-center gap-2 pt-3">
            <BrainCircuit className="w-4 h-4 text-agent/40" />
            <div className="h-3 w-14 rounded bg-muted" />
          </div>

          <div className="space-y-2.5 pt-1">
            {lines.map((width, i) => (
              <div
                key={i}
                className="h-3.5 rounded bg-muted/60"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
