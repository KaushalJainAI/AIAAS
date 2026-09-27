/**
 * A right-click menu: positioned at the pointer, kept on screen, closed by
 * Escape, a click elsewhere, a scroll or a resize. One level of submenu
 * ("Open with", "New") is enough for a file browser.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/utils';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  submenu?: MenuItem[];
}

export type MenuEntry = MenuItem | 'separator';

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[120] min-w-52 rounded-lg border border-border/70 bg-popover p-1 text-[13px] shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled), :scope > div > button:not(:disabled)') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
      }}
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border/70" role="separator" />
        ) : item.submenu ? (
          <div key={item.label} className="relative" onMouseEnter={() => setOpen(i)} onMouseLeave={() => setOpen(null)}>
            <Row item={item} onClick={() => setOpen(open === i ? null : i)} trailing={<ChevronRight className="h-3.5 w-3.5" />} />
            {open === i && item.submenu.length > 0 && (
              <div className="absolute left-full top-0 z-[121] -ml-1 min-w-48 rounded-lg border border-border/70 bg-popover p-1 shadow-xl sm:ml-0">
                <MenuList items={item.submenu} onClose={onClose} />
              </div>
            )}
          </div>
        ) : (
          <Row
            key={item.label}
            item={item}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          />
        ),
      )}
    </>
  );
}

function Row({ item, onClick, trailing }: { item: MenuItem; onClick: () => void; trailing?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none',
        'hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40',
        item.danger && 'text-destructive',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center text-muted-foreground">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.shortcut && <span className="text-[11px] text-muted-foreground">{item.shortcut}</span>}
      {trailing}
    </button>
  );
}
