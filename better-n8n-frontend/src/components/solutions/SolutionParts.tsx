/**
 * Pieces every solution view shares: the status badges, the read-only text of
 * a fix, and the reader of a server refusal.
 */
import { AlertTriangle } from 'lucide-react';

import type { Solution } from '../../api/solutions';
import { claimKindInfo } from '../../lib/solutionForm';
import { cn } from '../../lib/utils';

export function Badges({ s }: { s: Solution }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {s.status === 'draft' && (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">Draft: only you can see it</span>
      )}
      {s.status === 'pending_review' && (
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning dark:text-warning">Waiting for a curator</span>
      )}
      {s.doubtful && (
        <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-warning dark:text-warning">
          <AlertTriangle className="h-3 w-3" /> Doubtful
        </span>
      )}
      {s.status === 'needs_check' && (
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning dark:text-warning">Needs check</span>
      )}
      {s.status === 'superseded' && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">Replaced</span>
      )}
      {s.checks_needed.length > 0 && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
          {s.checks_needed.length} claim{s.checks_needed.length === 1 ? '' : 's'} may be out of date
        </span>
      )}
      {s.status !== 'draft' && s.status !== 'pending_review' && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
          {s.shared_with_org ? 'Shared' : 'Private'}
        </span>
      )}
    </div>
  );
}

/** The fix as it reads: what it solves, why, what to do, and what could change. */
export function SolutionText({ s }: { s: Solution }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-base font-medium">{s.problem}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Solved by {s.solved_by}{s.solved_on ? ` on ${s.solved_on}` : ''} · last known true {s.last_known_true}
          {' '}· worked for {s.track_record.worked}, failed for {s.track_record.failed}
        </p>
        <div className="mt-2"><Badges s={s} /></div>
      </div>
      {s.doubtful && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[13px]">
          <strong>Flagged as possibly wrong:</strong> {s.doubtful}
        </p>
      )}
      {s.symptoms && (
        <section>
          <h4 className="label-mono">Symptoms</h4>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px]">{s.symptoms}</pre>
        </section>
      )}
      {s.root_cause && (
        <section>
          <h4 className="label-mono">Cause</h4>
          <p className="mt-1 whitespace-pre-wrap">{s.root_cause}</p>
        </section>
      )}
      <section>
        <h4 className="label-mono">Fix</h4>
        <p className="mt-1 whitespace-pre-wrap">{s.resolution}</p>
      </section>
      {s.claims.length > 0 && (
        <section>
          <h4 className="label-mono">What could change</h4>
          <ul className="mt-1 space-y-1">
            {s.claims.map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[11px]',
                  c.state === 'check'
                    ? 'bg-warning/15 text-warning dark:text-warning'
                    : 'bg-success/15 text-success dark:text-success')}>
                  {c.state === 'check' ? 'Check' : 'Current'}
                </span>
                <span className="text-[11px] text-muted-foreground">{claimKindInfo(c.kind).label}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {Object.keys(s.environment || {}).length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          Applied to: {Object.entries(s.environment).map(([k, v]) => `${k} ${v}`).join(', ')}
        </p>
      )}
    </div>
  );
}
