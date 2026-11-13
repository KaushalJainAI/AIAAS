import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Button } from '../../../../../src/components/Button';
import { Card } from '../../../../../src/components/Card';
import { ErrorState } from '../../../../../src/components/ErrorState';
import { ErrorText } from '../../../../../src/components/ErrorText';
import { Icon, type IconName } from '../../../../../src/components/Icon';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { TextField } from '../../../../../src/components/TextField';
import { Text } from '../../../../../src/components/Text';
import { confirm } from '../../../../../src/components/confirm';
import { API_ORIGIN } from '../../../../../src/config';
import { messageOf } from '../../../../../src/features/agents/format';
import { useAgent } from '../../../../../src/features/agents/queries';
import { GroupHeader } from '../../../../../src/features/explore/GroupHeader';
import { requirementNoun } from '../../../../../src/features/explore/copy';
import {
  usePublishAgent,
  useSharePreview,
  useUnpublishAgent,
} from '../../../../../src/features/explore/queries';
import type { ShareVisibility } from '../../../../../src/features/explore/types';
import { success, tap, warning } from '../../../../../src/lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../../../../src/theme';

/** Three rungs, narrowest first. The widest one is the only one that leaves the platform, and says so. */
const VISIBILITY_ORDER: ShareVisibility[] = ['link', 'platform', 'public'];

const VISIBILITY_COPY: Record<ShareVisibility, { label: string; hint: string; icon: IconName }> = {
  link: { label: 'Anyone with the link', hint: 'Not listed anywhere.', icon: 'link-outline' },
  platform: { label: 'Everyone on this platform', hint: 'Listed on Explore for people with an account here.', icon: 'people-outline' },
  public: { label: 'Public: anyone on the internet', hint: 'Readable without an account. Installing still needs one.', icon: 'globe-outline' },
};

/**
 * Publish one of your agents for other people to install. The listing text is read
 * from the agent's own Basics (its description and brief), so the copy lives in one
 * place. The installer's requirement labels are editable here, before anything is written.
 */
export default function PublishAgentScreen() {
  const { agentId: rawId = '' } = useLocalSearchParams<{ agentId: string }>();
  const agentId = Number(rawId);
  const { colors, spacing: s } = useTheme();
  const agent = useAgent(agentId);
  const preview = useSharePreview(agentId, Number.isFinite(agentId));

  if (agent.isPending || preview.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Publish' }} />
        <LoadingState text="Working out what would be shared" />
      </Screen>
    );
  }
  if (agent.isError || !agent.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Publish' }} />
        <ErrorState message={messageOf(agent.error, 'Could not read this agent.')} />
      </Screen>
    );
  }
  if (preview.isError || !preview.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Publish' }} />
        <ErrorState
          title="Cannot publish yet"
          message={messageOf(preview.error, 'Could not read what would be shared.')}
          onRetry={() => void preview.refetch()}
        />
      </Screen>
    );
  }

  return (
    <PublishForm
      key={preview.data.version}
      agentId={agentId}
      agentName={agent.data.name}
      brief={agent.data.brief ?? ''}
      description={agent.data.description ?? ''}
      preview={preview.data}
      colors={colors}
      spacing={s}
    />
  );
}

type Preview = NonNullable<ReturnType<typeof useSharePreview>['data']>;

function PublishForm({
  agentId,
  agentName,
  brief,
  description,
  preview,
  colors,
  spacing: s,
}: {
  agentId: number;
  agentName: string;
  brief: string;
  description: string;
  preview: Preview;
  colors: ReturnType<typeof useTheme>['colors'];
  spacing: typeof spacing;
}) {
  const oneLiner = description.trim() || preview.tagline.trim() || agentName;
  const [tagline, setTagline] = useState(oneLiner);
  const [pitch, setPitch] = useState(brief.trim());
  const [visibility, setVisibility] = useState<ShareVisibility>(preview.visibility);
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(preview.requirements.map((r) => [r.key, r.label])),
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = usePublishAgent(agentId);
  const withdraw = useUnpublishAgent(agentId);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const busy = publish.isPending || withdraw.isPending;
  const canPublish = tagline.trim().length > 0 && !busy;
  const path = visibility === 'public' ? '/a/' : '/templates/';
  const shareUrl = preview.slug ? `${API_ORIGIN}${path}${preview.slug}` : '';
  const capabilities = Object.values(preview.config.tools ?? {}).filter(Boolean).length;

  const submit = async () => {
    if (!canPublish) return;
    if (visibility === 'public') {
      const ok = await confirm({
        title: 'Publish to the internet?',
        message:
          "Anyone will be able to read this agent's instructions without signing in. Withdrawing later unlists the page, but does not un-read it.",
        destructiveLabel: 'Publish',
      });
      if (!ok) return;
    }
    setError(null);
    publish.mutate(
      {
        tagline: tagline.trim().slice(0, 200),
        description: pitch.trim(),
        visibility,
        requirements: preview.requirements.map((r) => ({
          key: r.key,
          label: (labels[r.key] ?? r.label).trim() || r.label,
          why: r.why,
          optional: r.optional,
        })),
      },
      {
        onSuccess: () => success(),
        onError: (err) => setError(messageOf(err, 'Could not publish this agent.')),
      },
    );
  };

  const withdrawListing = async () => {
    const ok = await confirm({
      title: 'Withdraw from the listing?',
      message: 'People who installed a copy keep it. Withdrawing only removes this listing. You can publish again later.',
      destructiveLabel: 'Withdraw',
    });
    if (!ok) return;
    warning();
    setError(null);
    withdraw.mutate(undefined, {
      onError: (err) => setError(messageOf(err, 'Could not withdraw this listing.')),
    });
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    tap();
    setCopied(true);
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: preview.published ? 'Published' : 'Publish' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={[typography.body, { color: colors.mutedText }]}>
          People install a copy into their own account and point it at their own connections. Nothing of yours travels
          with it: no credentials, no documents, no runs.
        </Text>

        {preview.published ? (
          <Card>
            <View style={{ gap: s.sm }}>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                Published · version {preview.version} · {preview.install_count}{' '}
                {preview.install_count === 1 ? 'install' : 'installs'}
                {!preview.is_listed ? ' · currently withdrawn' : ''}
              </Text>
              {shareUrl ? (
                <View style={styles.linkRow}>
                  <Text numberOfLines={1} style={[typography.mono, styles.linkText, { color: colors.text }]}>
                    {shareUrl}
                  </Text>
                  <Button title={copied ? 'Copied' : 'Copy link'} variant="secondary" onPress={() => void copyLink()} />
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        <Card>
          <View style={{ gap: s.sm }}>
            <Text style={[typography.body, styles.listingName, { color: colors.text }]}>{agentName}</Text>
            <Text style={[typography.body, { color: colors.mutedText }]}>{tagline || oneLiner}</Text>
            {pitch ? <Text style={[typography.caption, { color: colors.mutedText }]}>{pitch}</Text> : null}
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Taken from the agent’s Basics. Edit them there.
            </Text>
          </View>
        </Card>

        <TextField
          label="One-line description"
          value={tagline}
          onChangeText={setTagline}
          maxLength={200}
          placeholder="What this agent is for"
        />
        <TextField
          label="Longer pitch"
          value={pitch}
          onChangeText={setPitch}
          multiline
          style={styles.multiline}
          placeholder="What it does, in a few lines"
        />

        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {capabilities} {capabilities === 1 ? 'capability' : 'capabilities'} ·{' '}
          {preview.requirements.length > 0
            ? `asks the installer for ${preview.requirements.length} ${preview.requirements.length === 1 ? 'thing' : 'things'}`
            : 'needs nothing from the installer'}
          .
        </Text>

        <GroupHeader title="Who can find it" />
        <View style={{ gap: s.sm }}>
          {VISIBILITY_ORDER.map((v) => {
            const { label, hint, icon } = VISIBILITY_COPY[v];
            const on = visibility === v;
            return (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ checked: on }}
                onPress={() => setVisibility(v)}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.background : colors.surface,
                    borderRadius: radius.md,
                    opacity: pressed ? pressedOpacity : 1,
                  },
                ]}
              >
                <Icon name={icon} size={18} color={on ? colors.primary : colors.mutedText} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text>
                </View>
                <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.mutedText} />
              </Pressable>
            );
          })}
        </View>

        {preview.requirements.length > 0 ? (
          <>
            <GroupHeader
              title="What installers supply"
              footer="Rename these so an installer knows what to choose. The kind of thing each one is cannot change."
            />
            <View style={{ gap: s.md }}>
              {preview.requirements.map((req) => (
                <View key={req.key} style={{ gap: s.xs }}>
                  <TextField
                    label={`${requirementNoun(req.type)}${req.optional ? ' (optional)' : ''}`}
                    value={labels[req.key] ?? req.label}
                    onChangeText={(text) => setLabels((prev) => ({ ...prev, [req.key]: text }))}
                  />
                  <Text style={[typography.caption, { color: colors.mutedText }]}>{req.why}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {visibility === 'public' ? (
          <Card>
            <Text style={[typography.caption, { color: colors.warning }]}>
              Public means anyone can read these instructions without signing in. Withdrawing unlists the page but does
              not un-read it.
            </Text>
          </Card>
        ) : null}

        <ErrorText message={error} />

        <Button
          title={preview.published ? 'Republish' : 'Publish'}
          onPress={() => void submit()}
          disabled={!canPublish}
          loading={publish.isPending}
        />
        {preview.published && preview.is_listed ? (
          <Button title="Withdraw from listing" variant="secondary" onPress={() => void withdrawListing()} loading={withdraw.isPending} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkText: { flex: 1 },
  listingName: { fontWeight: '600' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  choice: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
