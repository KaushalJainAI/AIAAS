/**
 * Delivery rules for HITL nudges.
 *
 * The three channels are shown in the order they escalate, because the split
 * between them is the thing a user needs to understand: device pings are
 * immediate and repeat, email is once a day and never more.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CalendarClock, Clock, Mail, MonitorSmartphone, Moon } from 'lucide-react';
import { toast } from 'sonner';
import {
  notificationsService,
  type NotificationPreferences,
} from '../../api/notifications';
import {
  deviceNotificationState,
  requestDeviceNotificationPermission,
} from '../../hooks/useHITLReminders';
import { useWebPush } from '../../hooks/useWebPush';
import { cn } from '../../lib/utils';

/** 'HH:MM:SS' from the API ↔ 'HH:MM' for <input type="time">. */
const toInputTime = (value: string | undefined) => (value ? value.slice(0, 5) : '09:00');
const toApiTime = (value: string) => (value.length === 5 ? `${value}:00` : value);

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // Flex + padding rather than a hardcoded translate: the knob is placed
        // by the track, so it stays inside it whatever either is sized to.
        'inline-flex items-center w-11 h-6 p-0.5 box-border rounded-full',
        'transition-colors shrink-0',
        checked ? 'bg-primary justify-end' : 'bg-muted-foreground/30 justify-start',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className="block w-5 h-5 rounded-full bg-white shadow" />
    </button>
  );
}

function Row({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-border/50 bg-card/40">
      <div className="mt-0.5 shrink-0 p-2 bg-background rounded-full border border-border/50">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
}

export default function ReminderPreferences() {
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState(deviceNotificationState());
  const webPush = useWebPush(true);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: notificationsService.getPreferences,
  });

  const save = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      notificationsService.updatePreferences(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['notification-preferences'], updated);
    },
    onError: () => toast.error('Could not save notification settings'),
  });

  const update = (patch: Partial<NotificationPreferences>) => save.mutate(patch);

  const enableDevice = async (next: boolean) => {
    if (next && permission !== 'granted') {
      // Must happen inside the click — browsers ignore ungated prompts.
      const result = await requestDeviceNotificationPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast.error(
          result === 'denied'
            ? 'Your browser is blocking notifications for this site. Allow them in site settings, then try again.'
            : 'Notifications are not available in this browser.',
        );
        return;
      }
    }
    update({ device_notifications_enabled: next });
  };

  if (isLoading || !prefs) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const deviceOn = prefs.device_notifications_enabled && permission === 'granted';

  const toggleBackground = async (next: boolean) => {
    if (next) {
      // Must happen inside the click — browsers ignore ungated prompts, and
      // the push subscription needs the grant before it exists.
      const ok = await webPush.enable();
      setPermission(deviceNotificationState());
      if (!ok) {
        if (!webPush.supported) {
          toast.error('This browser has no background-notification support, or the page is not on HTTPS.');
        } else if (!webPush.serverEnabled) {
          toast.error('Background push is not set up on the server yet (VAPID keys missing).');
        } else {
          toast.error('Your browser is blocking notifications for this site. Allow them in site settings, then try again.');
        }
      }
    } else {
      await webPush.disable();
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">When an agent needs you</h3>
        <p className="text-sm text-muted-foreground mt-1">
          A blocked run waits until you answer. These control how hard we try to reach you.
        </p>
      </div>

      {permission === 'denied' && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-warning-subtle text-sm">
          <BellOff className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-amber-600 dark:text-amber-400">
            This browser is blocking notifications for the site. Device pings stay off until you
            allow them in site settings.
          </span>
        </div>
      )}

      <Row
        icon={<MonitorSmartphone className="w-4 h-4 text-blue-500" />}
        title="Device notifications"
        description={
          permission === 'unsupported'
            ? 'This browser has no notification support.'
            : 'Desktop notification the moment an agent is blocked. Only fires while a tab is open — the daily email covers the rest.'
        }
      >
        <Toggle
          checked={deviceOn}
          disabled={permission === 'unsupported' || save.isPending}
          onChange={enableDevice}
        />
      </Row>

      <Row
        icon={<Bell className="w-4 h-4 text-sky-500" />}
        title="Background notifications"
        description={
          !webPush.supported
            ? 'Needs HTTPS (or localhost) plus a browser with push support.'
            : !webPush.serverEnabled
              ? 'The server has no push keys yet — ask whoever runs it to set VAPID keys.'
              : 'OS notification even with every tab closed. Same nudges as above, delivered by the browser push service.'
        }
      >
        <Toggle
          checked={webPush.subscribed}
          disabled={!webPush.supported || !webPush.serverEnabled || webPush.busy}
          onChange={toggleBackground}
        />
      </Row>

      <Row
        icon={<Bell className="w-4 h-4 text-emerald-500" />}
        title="Escalating reminders"
        description="Nudge straight away, again after an hour, then once more a day later. Stops as soon as you respond."
      >
        <Toggle
          checked={prefs.hitl_escalation_enabled}
          disabled={save.isPending}
          onChange={(next) => update({ hitl_escalation_enabled: next })}
        />
      </Row>

      <Row
        icon={<Clock className="w-4 h-4 text-violet-500" />}
        title="Hourly reminders"
        description="Optional. One extra ping every hour for as long as anything is still waiting on you."
      >
        <Toggle
          checked={prefs.hourly_reminders_enabled}
          disabled={save.isPending}
          onChange={(next) => update({ hourly_reminders_enabled: next })}
        />
      </Row>

      <div className="p-4 rounded-lg border border-border/50 bg-card/40 space-y-4">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0 p-2 bg-background rounded-full border border-border/50">
            <Mail className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold">Daily email digest</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              One roll-up of everything still open, at a time you pick. This is the only email
              we send — never more than one a day.
            </p>
          </div>
          <Toggle
            checked={prefs.daily_digest_enabled}
            disabled={save.isPending}
            onChange={(next) => update({ daily_digest_enabled: next })}
          />
        </div>

        {prefs.daily_digest_enabled && (
          <div className="flex flex-wrap items-center gap-3 pl-14">
            <CalendarClock className="w-4 h-4 text-muted-foreground" />
            <input
              type="time"
              // Uncontrolled + keyed: the field owns its text while being
              // edited, and remounts if the saved value changes underneath.
              key={prefs.daily_digest_time}
              defaultValue={toInputTime(prefs.daily_digest_time)}
              onBlur={(e) => {
                const next = toApiTime(e.target.value);
                if (e.target.value && next !== prefs.daily_digest_time) {
                  update({ daily_digest_time: next });
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-background border border-border/60 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              {prefs.effective_timezone}
              {!prefs.timezone && ' (from your profile)'}
            </span>
            {prefs.last_digest_sent_on && (
              <span className="text-xs text-muted-foreground/70">
                · last sent {prefs.last_digest_sent_on}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-4 rounded-lg border border-border/50 bg-card/40 space-y-4">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 shrink-0 p-2 bg-background rounded-full border border-border/50">
            <Moon className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold">Quiet hours</h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Hold device pings overnight. Requests still queue up in your Inbox, and the daily
              digest keeps its chosen time.
            </p>
          </div>
          <Toggle
            checked={prefs.quiet_hours_enabled}
            disabled={save.isPending}
            onChange={(next) => update({ quiet_hours_enabled: next })}
          />
        </div>

        {prefs.quiet_hours_enabled && (
          <div className="flex flex-wrap items-center gap-3 pl-14 text-sm">
            <input
              type="time"
              key={prefs.quiet_hours_start}
              defaultValue={toInputTime(prefs.quiet_hours_start)}
              onBlur={(e) => {
                const next = toApiTime(e.target.value);
                if (e.target.value && next !== prefs.quiet_hours_start) {
                  update({ quiet_hours_start: next });
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-background border border-border/60"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <input
              type="time"
              key={prefs.quiet_hours_end}
              defaultValue={toInputTime(prefs.quiet_hours_end)}
              onBlur={(e) => {
                const next = toApiTime(e.target.value);
                if (e.target.value && next !== prefs.quiet_hours_end) {
                  update({ quiet_hours_end: next });
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-background border border-border/60"
            />
          </div>
        )}
      </div>
    </div>
  );
}
