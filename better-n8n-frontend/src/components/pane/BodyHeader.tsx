/**
 * The header every pane body shares: a title, optional actions, and the hide
 * button. Its own file so each body can use it without importing `PaneBody`,
 * which imports the bodies.
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function BodyHeader({
  title,
  onHide,
  actions,
}: {
  title: string;
  onHide: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border/60 px-3 md:h-10">
      <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{title}</h2>
      {actions}
      <button
        type="button"
        onClick={onHide}
        aria-label="Hide preview"
        title="Hide preview"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:h-8 md:w-8"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
