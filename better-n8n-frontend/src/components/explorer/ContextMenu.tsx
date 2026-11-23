/**
 * A right-click menu: positioned at the pointer, kept on screen, closed by
 * Escape, a click elsewhere, a scroll or a resize. One level of submenu
 * ("Open with", "New") is enough for a file browser.
 *
 * On phones (below md) it is a bottom sheet of 44 px rows over a scrim. A
 * submenu replaces the list in the sheet, and a "‹ Back" row returns to it.
 * Desktop keeps the pointer-positioned menu with submenus that open on hover.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useIsDesktop } from '../../hooks/useIsDesktop';
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
  const desktop = useIsDesktop();
  const [pos, setPos] = useState({ x, y });
  // Phones: the submenu open in the sheet, if any. It replaces the list.
  const [sheetSub, setSheetSub] = useState<MenuItem | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !desktop) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y, desktop]);

  useEffect(() => {
    const close = (e: Event) => {
      // A press on a row, or a sheet scrolling its own list, keeps the menu open.
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
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

  // Phones show the open submenu in place of the list; desktop never does.
  const list: MenuEntry[] = (!desktop && sheetSub?.submenu) || items;
  const inSheetSub = !desktop && sheetSub !== null;

  return (
    <>
      {!desktop && (
        <div aria-hidden className="fixed inset-0 z-[119] bg-black/50 entrance-overlay" onClick={onClose} />
      )}
      <div
        ref={ref}
        role="menu"
        style={desktop ? { left: pos.x, top: pos.y } : undefined}
        className={cn(
          'fixed z-[120] min-w-52 rounded-md border border-border/70 bg-popover p-1 text-[13px] shadow-xl',
          // Phones: a bottom sheet, full width, rounded at the top only.
          'max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:min-w-0 max-md:max-h-[80dvh] max-md:overflow-y-auto',
          'max-md:rounded-b-none max-md:rounded-t-xl max-md:border-x-0 max-md:border-b-0 max-md:p-2',
          'max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )}
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
        {inSheetSub && (
          <Row item={{ label: 'Back', icon: <ChevronLeft className="h-4 w-4" /> }} onClick={() => setSheetSub(null)} />
        )}
        <MenuList items={list} onClose={onClose} onSubmenu={desktop ? undefined : setSheetSub} />
      </div>
    </>
  );
}

function MenuList({
  items,
  onClose,
  onSubmenu,
}: {
  items: MenuEntry[];
  onClose: () => void;
  /** Phones: a submenu row hands its submenu to the sheet instead of opening it beside the row. */
  onSubmenu?: (item: MenuItem) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-border/70" role="separator" />
        ) : item.submenu && onSubmenu ? (
          <Row
            key={item.label}
            item={item}
            onClick={() => onSubmenu(item)}
            trailing={<ChevronRight className="h-3.5 w-3.5" />}
          />
        ) : item.submenu ? (
          <div key={item.label} className="relative" onMouseEnter={() => setOpen(i)} onMouseLeave={() => setOpen(null)}>
            <Row item={item} onClick={() => setOpen(open === i ? null : i)} trailing={<ChevronRight className="h-3.5 w-3.5" />} />
            {open === i && item.submenu.length > 0 && (
              <div className="absolute left-full top-0 z-[121] -ml-1 min-w-48 rounded-md border border-border/70 bg-popover p-1 shadow-xl sm:ml-0">
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
        'max-md:min-h-11 max-md:px-3 max-md:text-[15px]',
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
