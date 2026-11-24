/**
 * Messaging channels (Slack, WhatsApp, Teams, SMS, Telegram).
 *
 * What the platform can message on and what each channel still needs — the
 * answer to "what can I connect" before anything is connected.
 */
import apiClient from './client';

export interface ChannelCredentialField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface ChannelCredential {
  slug: string;
  name: string;
  fields: ChannelCredentialField[];
  stored: boolean;
}

export interface ChannelAccount {
  id: number;
  label: string;
  verified: boolean;
}

export type ChannelStatus = 'ready' | 'needs_key' | 'needs_account' | 'gated';

export interface MessagingChannel {
  id: string;
  label: string;
  blurb: string;
  tools: string[];
  cost: string;
  credential: ChannelCredential;
  account: ChannelAccount | null;
  webhook_url: string | null;
  status: ChannelStatus;
  status_reason?: string;
  setup: string[];
  inbound: string;
}

export interface CreatedAccount {
  id: number;
  channel: string;
  label: string;
  verified: boolean;
  created: boolean;
  webhook_url: string | null;
}

/** A held send's state. `held` can still be cancelled; `sending` cannot. */
export type HoldStatus = 'held' | 'sending' | 'sent' | 'cancelled' | 'failed' | 'unknown';

/** One row of `GET /api/messaging/holds/` (`messaging/views.py::_hold_row`). */
export interface HoldRow {
  id: number;
  tool: string;
  label: string;
  status: HoldStatus;
  send_at: string;
  error: string;
  seconds_left: number;
}

export interface HoldList {
  holds: HoldRow[];
  truncated: boolean;
}

/** Cancel and send-now answer with the hold's status; 409 means it was too late. */
export interface HoldActionResult {
  status: HoldStatus;
}

export const messagingService = {
  async listChannels(): Promise<{ channels: MessagingChannel[] }> {
    const { data } = await apiClient.get('/messaging/channels/');
    return data;
  },

  async createAccount(channel: string, label = ''): Promise<CreatedAccount> {
    const { data } = await apiClient.post('/messaging/accounts/', {
      channel,
      label,
    });
    return data;
  },

  async registerAccount(
    id: number
  ): Promise<{ id: number; verified: boolean; webhook_url: string }> {
    const { data } = await apiClient.post(
      `/messaging/accounts/${id}/register/`
    );
    return data;
  },

  /** The caller's waiting sends, for one chat session and/or one run. */
  async listHolds(scope: {
    sessionId?: string;
    executionId?: string;
  }): Promise<HoldList> {
    const params: Record<string, string> = {};
    if (scope.sessionId) params.session = scope.sessionId;
    if (scope.executionId) params.execution = scope.executionId;
    const { data } = await apiClient.get<HoldList>('/messaging/holds/', { params });
    return data;
  },

  /**
   * Cancel a held send. 409 (too late: it is sending or already done) is an
   * answer, not an error, so it comes back with the current status.
   */
  async cancelHold(id: number): Promise<HoldActionResult> {
    const { data } = await apiClient.post<HoldActionResult>(
      `/messaging/holds/${id}/cancel/`,
      undefined,
      { validateStatus: (s) => s === 200 || s === 409 }
    );
    return data;
  },

  /** Send a held message now. 409 (no longer `held`) comes back as the current status. */
  async sendHoldNow(id: number): Promise<HoldActionResult> {
    const { data } = await apiClient.post<HoldActionResult>(
      `/messaging/holds/${id}/send-now/`,
      undefined,
      { validateStatus: (s) => s === 200 || s === 409 }
    );
    return data;
  },
};
