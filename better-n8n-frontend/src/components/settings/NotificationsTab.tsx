import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle, Clock, ShieldAlert, AlertTriangle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { notificationsService, type Notification } from '../../api/notifications';
import ReminderPreferences from './ReminderPreferences';
import ScheduledReminders from './ScheduledReminders';
import { cn } from '../../lib/utils';
import { formatDistanceToNow } from 'date-fns';

/**
 * Where a notification wants to send you, if anywhere.
 *
 * `data` is internal routing written by half a dozen places — `notifications/
 * reminders.py`, `eval/supervision.py`, `imagine/`, the chat approval — and
 * its shape varies per type. So this reads two agreed keys and ignores the
 * rest: an unrecognised payload renders a title and a message and nothing
 * more, which is the correct answer rather than a fallback.
 *
 * The internal path is validated against a small allow-list. `action_url` is
 * server-written today, but a link built from a stored value is exactly the
 * shape that becomes an open redirect the first time one of those writers
 * starts echoing something a user supplied.
 */
const ACTION_PATHS: Record<string, string> = {
  '/inbox': 'Answer requests',
  '/overview': 'Open Activity',
  '/chat': 'Open the conversation',
  '/ai-chat': 'Open the conversation',
  '/runs': 'Open Activity',
  '/documents': 'Open documents',
  '/settings': 'Open settings',
  '/evals': 'Review on Evals',
};

function actionLink(notification: Notification): { to: string; label: string } | null {
  const url = notification.data?.action_url;
  if (typeof url !== 'string') return null;
  // Exact allow-list matches, plus a same-origin path prefix for deep links
  // like /agents/12 or /runs?cursor=… that writers legitimately produce.
  if (ACTION_PATHS[url]) return { to: url, label: ACTION_PATHS[url] };
  if (url.startsWith('/') && !url.startsWith('//')) {
    const base = `/${url.slice(1).split('/')[0]}`;
    // `?request=` / `?run=` / `?session=` deep links arrive here from the
    // writers; the query is what makes them land on the thing, not the page.
    if (['/agents', '/runs', '/overview', '/documents', '/templates', '/ai-chat'].includes(base)) {
      return { to: url, label: 'Open' };
    }
  }
  return null;
}

export default function NotificationsTab() {
  const queryClient = useQueryClient();
  // Shared key with the socket hook (useHITLReminders invalidates this on
  // every reminder / generic notification), so the list refreshes live when
  // the socket is up and polls every 30s when it is not.
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationsService.getNotifications,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const handleMarkAsRead = async (id: number) => {
    try {
      await notificationsService.markAsRead(id);
      queryClient.setQueryData<Notification[]>(['notifications'], (prev) =>
        (prev ?? []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsService.markAllAsRead();
      queryClient.setQueryData<Notification[]>(['notifications'], (prev) =>
        (prev ?? []).map((n) => ({ ...n, is_read: true })),
      );
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'workflow_failed': return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'hitl_request': return <ShieldAlert className="w-5 h-5 text-amber-500" />;
      case 'hitl_reminder': return <ShieldAlert className="w-5 h-5 text-amber-500" />;
      case 'hitl_digest': return <Bell className="w-5 h-5 text-violet-500" />;
      case 'agent_update': return <Bell className="w-5 h-5 text-violet-500" />;
      case 'image_ready': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'new_message': return <Bell className="w-5 h-5 text-blue-500" />;
      default: return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6 max-w-4xl">
      <ReminderPreferences />

      <div className="border-t border-border/50 pt-6" />

      <ScheduledReminders />

      <div className="border-t border-border/50 pt-6" />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium">Recent notifications</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Everything the platform has alerted you about. New rows arrive live while this page is open.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refresh} className="text-sm text-muted-foreground hover:text-foreground font-medium">
            Refresh
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-sm text-primary hover:underline font-medium"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border/60 rounded-lg bg-card/30">
          <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground font-medium">No notifications yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1 max-w-sm mx-auto">
            Run an agent that needs approval, or let one notify you while it works unattended —
            approvals, updates and the daily digest land here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={cn(
                "p-4 rounded-lg border transition-all flex gap-4 items-start",
                notification.is_read
                  ? "bg-card/30 border-border/40 opacity-70"
                  : "bg-card/80 border-primary/20 shadow-sm"
              )}
            >
              <div className="mt-1 shrink-0 p-2 bg-background rounded-full border border-border/50">
                {getIcon(notification.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  {/* Not truncated. A notification whose whole content is its
                      title is the one row where clipping loses the message. */}
                  <h4 className={cn("text-sm font-semibold", !notification.is_read && "text-foreground")}>
                    {notification.title}
                  </h4>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1 shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {notification.message}
                </p>

                {/* `data` used to be printed here as a JSON block whenever it
                    was non-empty — thread ids, session ids, request ids, and
                    for a chat approval the raw tool arguments. None of it was
                    chosen for the reader; it was on screen because nobody had
                    decided what to show. Two keys are genuinely for them. */}
                <div className="mt-3 flex items-center gap-4">
                  {actionLink(notification) && (
                    <Link
                      to={actionLink(notification)!.to}
                      className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      {actionLink(notification)!.label}
                    </Link>
                  )}
                  {!notification.is_read && (
                    <button
                      onClick={() => handleMarkAsRead(notification.id)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Mark as read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
