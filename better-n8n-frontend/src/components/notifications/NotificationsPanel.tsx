import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Settings, X } from 'lucide-react';
import { notificationsService, type Notification } from '../../api/notifications';
import { notificationLink } from '../../lib/notificationLink';
import { cn } from '../../lib/utils';
import { Modal } from '../ui/Modal';

/* The bell's list. One component, two shapes:
 *  - `anchor` given (desktop sidebar): a popover beside the bell. It closes on
 *    Escape, on a click outside it, and on a window resize.
 *  - no `anchor` (phones): a `Modal`, which is a bottom sheet below `md`.
 *
 * It shares the `['notifications']` query with the sidebar's unread count, so
 * marking a row read updates the bell's dot in the same render pass.
 */

const NOTIFICATIONS_KEY = ['notifications'] as const;

export interface NotificationsPanelProps {
  onClose: () => void;
  /** The bell button on desktop. Omitted on phones, where the panel is a sheet. */
  anchor?: HTMLElement | null;
}

export function NotificationsPanel({ onClose, anchor }: NotificationsPanelProps) {
  if (anchor) {
    return (
      <Popover anchor={anchor} onClose={onClose}>
        <PanelContent onClose={onClose} />
      </Popover>
    );
  }
  return (
    <Modal onClose={onClose} size="md" label="Notifications">
      <PanelContent onClose={onClose} />
    </Modal>
  );
}

/** A fixed panel beside the anchor, portalled so the sidebar's overflow cannot clip it. */
function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Read once, when the panel opens. The bell does not move while it is open,
  // and a resize closes the panel rather than chasing the anchor.
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return { left: r.right + 8, bottom: window.innerHeight - r.bottom };
  });

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node | null;
      // The bell itself is excluded so its own click can toggle the panel.
      if (target && (panelRef.current?.contains(target) || anchor.contains(target))) return;
      onClose();
    };
    const onResize = () => onClose();
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      tabIndex={-1}
      style={{ left: pos.left, bottom: pos.bottom }}
      className="fixed z-[70] flex max-h-[70vh] w-96 max-w-[calc(100vw-6rem)] flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-lg outline-none"
    >
      {children}
    </div>,
    document.body,
  );
}

function whenLabel(createdAt: string): string {
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

/** Header, list and footer. Shared by the popover and the phone sheet. */
function PanelContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data = [], isLoading, isError } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: notificationsService.getNotifications,
    refetchInterval: 30_000,
  });

  const newestFirst = [...data].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const unreadCount = data.filter((n) => !n.is_read).length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  };

  const markRead = (id: number) => {
    queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (prev) =>
      (prev ?? []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    notificationsService
      .markAsRead(id)
      .catch((err: unknown) => console.error('Failed to mark notification as read:', err))
      .finally(refresh);
  };

  const markAllRead = () => {
    queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (prev) =>
      (prev ?? []).map((n) => ({ ...n, is_read: true })),
    );
    notificationsService
      .markAllAsRead()
      .catch((err: unknown) => console.error('Failed to mark all as read:', err))
      .finally(refresh);
  };

  // Marking read never waits on the network: the row is read locally, the
  // request follows, and the tap goes wherever the notification points.
  const open = (n: Notification) => {
    const link = notificationLink(n);
    if (!n.is_read) markRead(n.id);
    onClose();
    if (link) navigate(link);
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Notifications</h2>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex min-h-11 items-center text-sm font-medium text-primary hover:underline md:min-h-0"
            >
              Mark all as read
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close notifications"
          title="Close"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>}
        {isError && !isLoading && (
          <p className="px-4 py-6 text-sm text-destructive">Could not load notifications.</p>
        )}
        {!isLoading && !isError && newestFirst.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        )}
        {newestFirst.length > 0 && (
          <ul className="divide-y divide-border/60">
            {newestFirst.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cn(
                    'flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    !n.is_read && 'bg-primary/5',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      n.is_read ? 'bg-transparent' : 'bg-warning',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {n.title}
                    </span>
                    {n.message && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                        {n.message}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {whenLabel(n.created_at)}
                      {!n.is_read && <span className="sr-only">, unread</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border">
        <Link
          to="/settings?tab=notifications"
          onClick={onClose}
          className="flex min-h-11 items-center gap-2 px-4 text-sm font-medium text-primary transition-colors hover:bg-muted/60"
        >
          <Settings className="h-4 w-4 shrink-0" />
          Notification settings
        </Link>
      </div>
    </>
  );
}
