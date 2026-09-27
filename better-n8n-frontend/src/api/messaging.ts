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
};
