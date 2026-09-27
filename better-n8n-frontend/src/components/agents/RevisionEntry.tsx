/**
 * One configuration change, rendered the same way wherever it is read.
 *
 * The builder shows the newest few inline and `/agents/:id/history` shows the
 * whole timeline; both render this, because a diff row that reads differently
 * in two places is two records of the same event. The only difference between
 * them is how many fields open by default — inline, a revision that touched
 * fourteen settings must not push the rest of the board off the screen, so the
 * overflow is behind its own disclosure rather than silently dropped. A diff
 * that was cut and a diff that was short must not look alike, which is why the
 * button counts what is hidden instead of saying "more".
 */
import { useState } from 'react';
import type { AgentRevision } from '../../api/logs';

/** One side of a diff, shortened to fit a line. Objects are summarised rather
 *  than stringified: a full `tools` map would swamp the row it sits in. */
function summariseValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : `${value.length} item(s)`;
  if (typeof value === 'object') {
    const on = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return on.length === 0 ? 'none' : on.join(', ');
  }
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export default function RevisionEntry({
  revision, collapseAfter = 6, onRestore, restoring = false,
}: {
  revision: AgentRevision;
  /** How many diff rows show before the disclosure. `Infinity` opens them all. */
  collapseAfter?: number;
  /** Put this version back. Omitted for the current version, where it would
   *  be a no-op dressed as an action. */
  onRestore?: () => void;
  restoring?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fields = Object.entries(revision.diff);
  const shown = expanded ? fields : fields.slice(0, collapseAfter);
  const hidden = fields.length - shown.length;

  return (
    <li className="border-l-2 border-border pl-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold">v{revision.number}</span>
        <span className="text-[12px] text-muted-foreground truncate flex-1">
          {revision.summary}
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
          {revision.run_count} {revision.run_count === 1 ? 'run' : 'runs'}
        </span>
        {onRestore && (
          <button type="button" onClick={onRestore} disabled={restoring}
            title="Put the agent back to this version. Saved as a new version; nothing is erased."
            className="text-[11px] text-primary hover:underline shrink-0 disabled:opacity-50">
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {revision.changed_by ?? 'system'} · {new Date(revision.created_at).toLocaleString()}
      </div>
      {fields.length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {shown.map(([field, change]) => (
            <div key={field} className="flex gap-2 text-[11px]">
              <dt className="text-muted-foreground w-28 shrink-0 truncate">{field}</dt>
              <dd className="truncate">
                <span className="text-muted-foreground line-through">
                  {summariseValue(change.from)}
                </span>
                {' → '}
                <span>{summariseValue(change.to)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-[11px] font-medium text-primary hover:underline"
        >
          Show {hidden} more {hidden === 1 ? 'field' : 'fields'}
        </button>
      )}
      {expanded && fields.length > collapseAfter && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-[11px] font-medium text-muted-foreground hover:underline"
        >
          Show less
        </button>
      )}
    </li>
  );
}
