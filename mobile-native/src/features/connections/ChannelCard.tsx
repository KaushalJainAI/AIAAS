import { useState } from 'react';
import { View } from 'react-native';

import { Badge, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { ErrorText } from '../../components/ErrorText';
import { fontFamily, fontSize, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { useCreateMessagingAccount, useRegisterMessagingAccount } from './queries';
import { success } from '../../lib/haptics';
import type { MessagingChannel } from './types';

/** The web's words for each channel status. */
const STATUS_LABEL: Record<MessagingChannel['status'], string> = {
  ready: 'Connected',
  needs_key: 'Needs key',
  needs_account: 'Key stored',
  gated: 'Unavailable',
};

const STATUS_TONE: Record<MessagingChannel['status'], Tone> = {
  ready: 'success',
  needs_key: 'warning',
  needs_account: 'info',
  gated: 'neutral',
};

interface Props {
  channel: MessagingChannel;
  /** Opens the credential form for this channel's key. Null when the platform did not seed the type. */
  onAddKey: (() => void) | null;
}

/**
 * One messaging channel: what it needs, and the next action. Adding the key
 * is a credential, so it goes through the same form as every other credential.
 */
export function ChannelCard({ channel, onAddKey }: Props) {
  const { colors } = useTheme();
  const create = useCreateMessagingAccount();
  const register = useRegisterMessagingAccount();
  const [error, setError] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<string | null>(null);

  const needsKey = channel.status === 'needs_key';
  const canRegister = channel.id === 'telegram' && channel.account !== null && !channel.account.verified && !needsKey;
  const busy = create.isPending || register.isPending;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semibold }}>{channel.label}</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{channel.cost}</Text>
        </View>
        <Badge label={STATUS_LABEL[channel.status]} tone={STATUS_TONE[channel.status]} />
      </View>

      <Text style={[typography.body, { color: colors.mutedText }]}>{channel.blurb}</Text>

      {channel.status_reason ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>{channel.status_reason}</Text>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        {channel.setup.map((step, index) => (
          <Text key={step} style={[typography.caption, { color: colors.mutedText }]}>
            {index + 1}. {step}
          </Text>
        ))}
      </View>

      <View style={{ gap: spacing.sm }}>
        {needsKey && onAddKey ? (
          <Button title="Add key" onPress={onAddKey} />
        ) : null}
        {channel.status === 'needs_account' ? (
          <Button
            title="Add account"
            loading={create.isPending}
            disabled={busy}
            onPress={() => {
              setError(null);
              create.mutate(
                { channel: channel.id },
                {
                  onSuccess: (created) => {
                    success();
                    setWebhook(created.webhook_url);
                  },
                  onError: (err) => setError(errorMessage(err, 'Could not add that account.')),
                },
              );
            }}
          />
        ) : null}
        {canRegister && channel.account ? (
          <Button
            title="Register webhook"
            variant="secondary"
            loading={register.isPending}
            disabled={busy}
            onPress={() => {
              setError(null);
              register.mutate(channel.account!.id, {
                onSuccess: (done) => {
                  success();
                  setWebhook(done.webhook_url);
                },
                onError: (err) => setError(errorMessage(err, 'Registration failed.')),
              });
            }}
          />
        ) : null}
        {channel.account?.verified ? (
          <Text style={[typography.caption, { color: colors.success }]}>Replies arrive</Text>
        ) : null}
        {webhook ? (
          <Text selectable style={[typography.mono, { color: colors.mutedText }]}>{webhook}</Text>
        ) : null}
      </View>
      <ErrorText message={error} />
    </Card>
  );
}
