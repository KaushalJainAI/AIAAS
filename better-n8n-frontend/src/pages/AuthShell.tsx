import type { ReactNode } from 'react';

/**
 * The frame for the sign-in, sign-up and reset screens.
 *
 * Phones get one centred column. From md up the column sits beside a calm
 * panel that says what the product does before anyone signs in (the same
 * panel as the SignIn reference). The panel is decoration: it is hidden from
 * assistive tech and never holds a control.
 */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10 md:py-16">
        {children}
      </main>

      <aside
        aria-hidden="true"
        className="hidden flex-col justify-center gap-6 border-l border-border bg-muted/40 px-10 py-16 md:flex"
      >
        <p className="label-mono">AIAAS</p>
        <h2 className="text-xl font-semibold leading-snug">
          Agents that do the work, and ask before anything you can&rsquo;t undo.
        </h2>

        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-agent-subtle font-mono text-[11px] text-agent">
              AN
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">An analyst needs you</p>
              <p className="text-[12px] text-muted-foreground">
                Wants to send a supplier an email about an overcharge.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Approve</span>
            <span className="rounded border border-border px-3 py-1 text-xs font-medium text-muted-foreground">Review</span>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Chat plans the work and hands it to specialist agents.</li>
          <li>Each agent reaches only the files and accounts you give it.</li>
          <li>Every run is recorded: what it read, decided and spent.</li>
        </ul>
      </aside>
    </div>
  );
}
