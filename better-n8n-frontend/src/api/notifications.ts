import { asArray } from './unwrap';
import apiClient from './client';

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  /** Payload shape varies by notification type; read defensively. */
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

/** Per-user delivery rules for HITL nudges. Mirrors NotificationPreference. */
export interface NotificationPreferences {
  device_notifications_enabled: boolean;
  hitl_escalation_enabled: boolean;
  hourly_reminders_enabled: boolean;
  daily_digest_enabled: boolean;
  /** 'HH:MM:SS', local to `timezone`. */
  daily_digest_time: string;
  /** Blank falls back to the profile timezone; `effective_timezone` resolves it. */
  timezone: string;
  effective_timezone: string;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  /** Read-only bookkeeping — the once-per-day email cap. */
  last_digest_sent_on: string | null;
  last_hourly_sent_at: string | null;
  updated_at: string;
}

/** A nudge pushed over ws/hitl/ that the client turns into an OS notification. */
export interface HITLReminderPayload {
  kind: 'hitl_request' | 'hitl_reminder' | 'hitl_digest';
  title: string;
  body: string;
  request_id?: string;
  stage?: number;
  pending_count?: number;
  action_url?: string;
}

/** A live user-asked reminder. Creation stays in chat (the tool quotes the
 *  user's own timing); this surface lists and cancels. */
export interface ScheduledReminder {
  id: number;
  title: string;
  message: string;
  repeat: 'none' | 'hourly' | 'daily' | 'weekly';
  send_email: boolean;
  next_run_at: string;
  last_sent_at: string | null;
  times_sent: number;
  created_at: string;
}

/** One browser subscribed for closed-browser push (Web Push). */
export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  created_at: string;
}

/** What PushManager.subscribe() yields, flattened for the API. */
export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
}

export const notificationsService = {
  async getNotifications(): Promise<Notification[]> {
    const response = await apiClient.get('/notifications/');
    // DRF returns {count, next, previous, results} for this router viewset, but
    // the signature says Notification[] — TypeScript believed it and the
    // .filter() in NotificationsTab threw "e.filter is not a function".
    return asArray<Notification>(response.data);
  },

  async markAsRead(id: number): Promise<void> {
    await apiClient.post(`/notifications/${id}/mark_read/`, {});
  },

  async markAllAsRead(): Promise<void> {
    await apiClient.post('/notifications/mark_all_read/', {});
  },

  async getPreferences(): Promise<NotificationPreferences> {
    const response = await apiClient.get<NotificationPreferences>('/notifications/preferences/');
    return response.data;
  },

  async updatePreferences(patch: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const response = await apiClient.patch<NotificationPreferences>('/notifications/preferences/', patch);
    return response.data;
  },

  /** VAPID public key + whether the server can push with tabs closed. */
  async getVapidKey(): Promise<{ public_key: string; enabled: boolean }> {
    const response = await apiClient.get('/notifications/push/vapid-key/');
    return response.data;
  },

  async subscribePush(sub: PushSubscriptionPayload): Promise<PushSubscriptionRow> {
    const response = await apiClient.post('/notifications/push/subscribe/', sub);
    return response.data;
  },

  async unsubscribePush(endpoint: string): Promise<void> {
    await apiClient.post('/notifications/push/unsubscribe/', { endpoint });
  },

  async listScheduled(): Promise<ScheduledReminder[]> {
    const response = await apiClient.get('/notifications/scheduled/');
    return asArray<ScheduledReminder>(response.data);
  },

  async cancelScheduled(id: number): Promise<void> {
    await apiClient.delete(`/notifications/scheduled/${id}/`);
  },
};
