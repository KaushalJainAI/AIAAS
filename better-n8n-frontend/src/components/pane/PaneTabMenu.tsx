/**
 * The tab actions menu: under the ⋯ button, or on a right-click of a tab.
 * Same popover look as `ExportMenu` in `components/files/PreviewFrame.tsx`.
 *
 * It closes on a pointer press outside it (except the ⋯ button, which toggles
 * it) and on Escape. The pane's own Escape is held back while it is open.
 */
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  hasOthers: boolean;
  hasRight: boolean;
  canReopen: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onReopen: () => void;
  onDismiss: () => void;
}

const ITEM =
  'flex h-11 w-full items-center rounded px-2 text-left text-[13px] hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent md:h-auto md:py-1.5';

export default function PaneTabMenu({
  hasOthers,
  hasRight,
  canReopen,
  onClose,
  onCloseOthers,
  onCloseRight,
  onReopen,
  onDismiss,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && ref.current?.contains(target)) return;
      if (target?.closest?.('[data-pane-menu-toggle]')) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Tab actions"
      className="absolute right-2 top-full z-40 mt-1 w-56 rounded-md border border-border/60 bg-popover p-1 shadow-lg"
    >
      <button type="button" role="menuitem" onClick={onClose} className={cn(ITEM)}>
        Close
      </button>
      <button type="button" role="menuitem" onClick={onCloseOthers} disabled={!hasOthers} className={cn(ITEM)}>
        Close other tabs
      </button>
      <button type="button" role="menuitem" onClick={onCloseRight} disabled={!hasRight} className={cn(ITEM)}>
        Close tabs to the right
      </button>
      <div className="my-1 h-px bg-border/60" />
      <button type="button" role="menuitem" onClick={onReopen} disabled={!canReopen} className={cn(ITEM)}>
        Reopen closed tab
      </button>
    </div>
  );
}
