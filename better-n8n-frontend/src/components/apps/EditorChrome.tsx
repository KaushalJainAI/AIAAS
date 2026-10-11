/**
 * The frame every app editor shares: a toolbar row, the stale-write banner,
 * and the save status. Kept dumb — each editor owns its own state and passes
 * in what to show, so a spreadsheet and a text file save the same way.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, RotateCcw, Save } from 'lucide-react';

import { cn } from '../../lib/utils';

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // One scrollable row on phones (a wrapping toolbar would eat the
        // document); wrapping rows again from md up.
        'app-no-print flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-border/60 bg-card px-2 py-1.5 md:flex-wrap md:overflow-visible',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolButton({
  onClick,
  title,
  active,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-[12.5px] transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="mx-1 h-5 w-px bg-border/70" aria-hidden />;
}

export function StaleBanner({ onReload, onOverwrite }: { onReload: () => void; onOverwrite: () => void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning-subtle px-4 py-2 text-[12.5px] text-warning">
      <span className="min-w-0 flex-1">
        This file changed since you opened it — an agent or another tab may have saved it. Your edit is still here.
      </span>
      <button type="button" onClick={onReload} className="inline-flex items-center gap-1 font-medium hover:underline">
        <RotateCcw className="h-3.5 w-3.5" /> Load newer version
      </button>
      <button type="button" onClick={onOverwrite} className="font-medium hover:underline">
        Keep mine and save
      </button>
    </div>
  );
}

export function SaveStatus({
  dirty,
  saving,
  onSave,
  hint = 'Ctrl+S to save',
  extra,
  readOnly,
}: {
  dirty: boolean;
  saving: boolean;
  onSave?: () => void;
  hint?: string;
  extra?: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <div className="app-no-print flex shrink-0 items-center gap-3 border-t border-border/60 bg-card px-3 py-1.5 text-[11.5px] text-muted-foreground">
      {readOnly ? (
        <span>Read-only</span>
      ) : saving ? (
        <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
      ) : dirty ? (
        <span className="font-medium text-foreground">• Unsaved changes</span>
      ) : (
        <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>
      )}
      {!readOnly && <span className="hidden sm:inline">{hint}</span>}
      <span className="ml-auto flex min-w-0 items-center gap-3 truncate">{extra}</span>
      {onSave && !readOnly && (
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
      )}
    </div>
  );
}

export function EditorLoading({ label = 'Opening…' }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function EditorError({ message }: { message: string }) {
  return <p className="flex-1 px-6 py-16 text-center text-sm text-muted-foreground">{message}</p>;
}

export interface ToolMenuItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  /** Right-aligned note, e.g. a shortcut. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Draw a rule above this item. */
  divider?: boolean;
}

/**
 * A toolbar button that opens a list of commands.
 *
 * The list is positioned against the viewport and portalled to the body: on
 * phones the toolbar is one scrolling row, and a list positioned inside it
 * would be clipped by that row's overflow.
 */
export function ToolMenu({
  title,
  children,
  items,
  align = 'left',
  disabled,
}: {
  title: string;
  children: ReactNode;
  items: ToolMenuItem[];
  align?: 'left' | 'right';
  disabled?: boolean;
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return undefined;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAt(null);
    };
    const onResize = () => setAt(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [at]);

  const toggle = () => {
    if (at) {
      setAt(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 232;
    const wanted = align === 'right' ? rect.right - width : rect.left;
    setAt({
      top: rect.bottom + 4,
      left: Math.max(8, Math.min(wanted, window.innerWidth - width - 8)),
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        disabled={disabled}
        className={cn(
          'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[12.5px] transition-colors',
          'disabled:pointer-events-none disabled:opacity-40',
          at ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {children}
      </button>
      {at && createPortal(
        <div
          ref={listRef}
          role="menu"
          style={{ top: at.top, left: at.left, maxHeight: `calc(100dvh - ${at.top + 8}px)` }}
          className="fixed z-[60] w-[232px] overflow-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.divider && <div className="mx-2 my-1 h-px bg-border/60" aria-hidden />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setAt(null);
                  item.onClick();
                }}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40',
                  item.danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted',
                )}
              >
                {item.icon && <span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[11px] text-muted-foreground">{item.hint}</span>}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Edit / Split / Preview — the three ways a source file with a rendering is shown. */
export type SplitView = 'edit' | 'split' | 'preview';

export function ViewSwitch({
  view,
  onChange,
  options,
}: {
  view: SplitView;
  onChange: (next: SplitView) => void;
  options: readonly (readonly [SplitView, ComponentType<{ className?: string }>, string])[];
}) {
  return (
    <div className="ml-auto flex shrink-0 rounded-md border border-border/60 p-0.5" role="group" aria-label="View">
      {options.map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-[12px]',
            value === 'split' && 'hidden lg:inline-flex',
            view === value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}
