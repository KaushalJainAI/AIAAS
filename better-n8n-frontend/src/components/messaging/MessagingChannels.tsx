/**
 * Messaging channels: what the platform can message on and what each channel
 * still needs. Rendered on Connections so a supported tool is visible before
 * it is connected — a key the user cannot find might as well not exist.
 *
 * Data comes from `GET /api/messaging/channels/` (per-caller status); keys
 * are stored through the shared `CredentialModal`, accounts are created and
 * Telegram webhooks registered from the card.
 */
import { useState } from 'react';
import {
  AlertCircle,
  Check,
  Key,
  Loader2,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  Smartphone,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { messagingService, type MessagingChannel } from '../../api/messaging';
import type { CredentialType } from '../../api/credentials';
import CredentialModal from '../credentials/CredentialModal';
import { cn } from '../../lib/utils';

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  slack: MessageSquare,
  telegram: Send,
  whatsapp: Phone,
  sms: Smartphone,
  teams: Users,
};

const STATUS_STYLES: Record<MessagingChannel['status'], string> = {
  ready: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  needs_key: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  needs_account: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
  gated: 'bg-muted text-muted-foreground border-border/60',
};

const STATUS_LABELS: Record<MessagingChannel['status'], string> = {
  ready: 'Connected',
  needs_key: 'Needs key',
  needs_account: 'Key stored',
  gated: 'Unavailable',
};

function ChannelCard({
  channel,
  credType,
  credentialTypes,
  onKeyStored,
}: {
  channel: MessagingChannel;
  credType: CredentialType | null;
  credentialTypes: CredentialType[];
  onKeyStored: () => void;
}) {
  const queryClient = useQueryClient();
  const [keyOpen, setKeyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = CHANNEL_ICONS[channel.id] ?? MessageCircle;

  const accountMutation = useMutation({
    mutationFn: () => messagingService.createAccount(channel.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messagingChannels'] });
      toast.success(`${channel.label} account added`);
    },
    onError: () => toast.error('Could not add that account.'),
    onSettled: () => setBusy(false),
  });

  const registerMutation = useMutation({
    mutationFn: (id: number) => messagingService.registerAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messagingChannels'] });
      toast.success('Webhook registered — replies will arrive');
    },
    onError: (err: unknown) => {
      const res = (err as { response?: { data?: { error?: string } } })
        .response;
      toast.error(res?.data?.error ?? 'Registration failed.');
    },
    onSettled: () => setBusy(false),
  });

  const needsKey = channel.status === 'needs_key';
  const canRegister =
    channel.id === 'telegram' &&
    channel.account !== null &&
    !channel.account.verified &&
    !needsKey;

  return (
    <div className="border border-border/60 rounded-lg p-4 bg-card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-4.5 h-4.5 text-primary" />
          </span>
          <div>
            <p className="font-bold text-sm text-foreground">{channel.label}</p>
            <p className="text-xs text-muted-foreground">{channel.cost}</p>
          </div>
        </div>
        <span
          className={cn(
            'text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0',
            STATUS_STYLES[channel.status]
          )}
        >
          {STATUS_LABELS[channel.status]}
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        {channel.blurb}
      </p>

      {channel.status_reason && (
        <p className="text-xs text-muted-foreground leading-relaxed flex gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {channel.status_reason}
        </p>
      )}

      <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
        {channel.setup.map((step) => (
          <li key={step} className="leading-relaxed">
            {step}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {needsKey && credType && (
          <button
            onClick={() => setKeyOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors"
          >
            <Key className="w-3.5 h-3.5" />
            Add key
          </button>
        )}
        {channel.status === 'needs_account' && (
          <button
            onClick={() => {
              setBusy(true);
              accountMutation.mutate();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Add account
          </button>
        )}
        {canRegister && (
          <button
            onClick={() => {
              setBusy(true);
              registerMutation.mutate(channel.account!.id);
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border/60 rounded-lg text-xs font-bold hover:bg-muted transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Webhook className="w-3.5 h-3.5" />
            )}
            Register webhook
          </button>
        )}
        {channel.account?.verified && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            Replies arrive
          </span>
        )}
      </div>

      {keyOpen && credType && (
        <CredentialModal
          isOpen={keyOpen}
          onClose={() => setKeyOpen(false)}
          onSave={() => {
            onKeyStored();
            setKeyOpen(false);
          }}
          preselectedType={credType}
          credentialTypes={credentialTypes}
        />
      )}
    </div>
  );
}

export default function MessagingChannels({
  credentialTypes,
  onKeyStored,
}: {
  credentialTypes: CredentialType[];
  onKeyStored: () => void;
}) {
  const channelsQuery = useQuery({
    queryKey: ['messagingChannels'],
    queryFn: () => messagingService.listChannels(),
    staleTime: 60 * 1000,
  });

  const channels = channelsQuery.data?.channels ?? [];
  const credTypeBySlug = new Map(credentialTypes.map((t) => [t.slug, t]));

  // Slack reads the `slack` vault type; every other channel reads the type
  // the catalogue names. A type the backend never seeded renders the card
  // without an Add-key button rather than crashing the section.
  if (channelsQuery.isLoading) {
    return (
      <section>
        <h2 className="text-base font-bold text-foreground">Messaging</h2>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          What your assistant can message on your behalf
        </p>
        <p className="text-xs text-muted-foreground">Loading channels…</p>
      </section>
    );
  }

  if (channelsQuery.error || channels.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-bold text-foreground">Messaging</h2>
      <p className="text-xs text-muted-foreground mt-0.5 mb-4">
        What your assistant can message on your behalf — draft, send, search
        and read, on every channel below.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            credType={credTypeBySlug.get(channel.credential.slug) ?? null}
            credentialTypes={credentialTypes}
            onKeyStored={onKeyStored}
          />
        ))}
      </div>
    </section>
  );
}
