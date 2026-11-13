// Shapes the settings screens read and write. Copied from the web app:
//   better-n8n-frontend/src/api/auth.ts       (profile)
//   better-n8n-frontend/src/api/memory.ts     (memory)
//   better-n8n-frontend/src/api/notifications.ts (notification preferences)

export type Tier = 'free' | 'pro' | 'enterprise';

/**
 * GET /api/auth/profile/ (and the PATCH response, which is the same serializer).
 * Only the fields the settings screens use are listed.
 */
export interface ProfileResponse {
  user: {
    id: number;
    email: string;
    username: string;
    first_name: string;
    last_name: string;
  };
  tier: Tier;
  credits_remaining: number;
}

/**
 * PATCH /api/auth/profile/ body. The backend reads names from a nested `user`
 * object (core/serializers.py::UserProfileSerializer.update). Email is refused
 * on this route, so it is not sent.
 */
export interface ProfileNamePatch {
  user: {
    first_name: string;
    last_name: string;
  };
}

/** One durable fact the assistant has stored (GET /api/memory/). */
export interface UserMemory {
  id: number;
  text: string;
  /** profile | preference | project | context (unknown values group under context). */
  category: string;
  source: string;
  updated_at: string;
  /** False = stored but not shown to the model because the memory block is full. Absent = assume true. */
  in_prompt?: boolean;
}

/** GET /api/memory/ response. */
export interface MemoryList {
  memories: UserMemory[];
  /** For "24 of 25" counts. */
  max_per_category: number;
  max_prompt_chars?: number;
}

/** Per-user delivery rules for HITL nudges (GET/PATCH /api/notifications/preferences/). */
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
  /** Read-only bookkeeping. */
  last_digest_sent_on: string | null;
  last_hourly_sent_at: string | null;
  updated_at: string;
}

/**
 * The preferences this app edits. Device and background (web push) toggles
 * are left out: they describe a browser, and the phone app has no push yet.
 */
export type NotificationPreferencesPatch = Partial<
  Pick<
    NotificationPreferences,
    | 'hitl_escalation_enabled'
    | 'hourly_reminders_enabled'
    | 'daily_digest_enabled'
    | 'daily_digest_time'
    | 'quiet_hours_enabled'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
  >
>;
