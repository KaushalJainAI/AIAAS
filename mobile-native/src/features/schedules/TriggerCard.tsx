import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '../../components/Switch';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';

import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { confirm } from '../../components/confirm';
import { ErrorText } from '../../components/ErrorText';
import { Icon, type IconName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { messageOf } from '../agents/format';
import { API_ORIGIN } from '../../config';
import { success, tap, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import { absolute, lastRunCopy, OUTCOME_COPY, relative, statusTone, type CopyTone } from './format';
import { absoluteHookUrl, curlFor } from './webhook';
import {
  useAgentFix,
  useDeleteTrigger,
  useRotateTriggerSecret,
  useRunTriggerNow,
  useUpdateTrigger,
} from './queries';
import type { FireOutcome, Trigger, TriggerMode } from './types';

const MODE_LABEL: Record<TriggerMode, string> = { schedule: 'Schedule', webhook: 'Webhook', event: 'Event' };
const MODE_ICON: Record<TriggerMode, IconName> = {
  schedule: 'calendar-outline',
  webhook: 'link-outline',
  event: 'radio-outline',
};

interface Props {
  trigger: Trigger;
  onEdit: () => void;
}

/** One schedule or webhook: what it says, when it fires next, what happened last, and the controls. */
export function TriggerCard({ trigger, onEdit }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const toggle = useUpdateTrigger(trigger.id);
  const runNow = useRunTriggerNow();
  const rotate = useRotateTriggerSecret();
  const remove = useDeleteTrigger();
  const fix = useAgentFix();
  const [outcome, setOutcome] = useState<{ outcome: FireOutcome; executionId?: string } | null>(null);
  const [copied, setCopied] = useState<'url' | 'curl' | null>(null);
  const [confirmAllow, setConfirmAllow] = useState(false);

  const isSchedule = trigger.mode === 'schedule';
  const isWebhook = trigger.mode === 'webhook';
  const hookUrl = absoluteHookUrl(trigger.webhook_url, API_ORIGIN);
  const lastCopy = lastRunCopy(trigger.last_outcome, trigger.last_run_status) ?? (trigger.last_outcome ? OUTCOME_COPY[trigger.last_outcome] : null);
  const tone = statusTone(trigger.status);

  const copy = async (what: 'url' | 'curl') => {
    if (!hookUrl) return;
    await Clipboard.setStringAsync(what === 'url' ? hookUrl : curlFor(hookUrl));
    tap();
    setCopied(what);
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const onRunNow = () => {
    setOutcome(null);
    runNow.mutate(trigger.id, {
      onSuccess: (res) => {
        setOutcome({ outcome: res.outcome, executionId: res.execution_id });
        if (res.outcome === 'fired') success();
      },
    });
  };

  const onRotate = async () => {
    const ok = await confirm({
      title: 'Issue a new URL?',
      message: 'A new URL is issued immediately and this one stops working. Anything already pointed at it will start getting 404s until you update it.',
      destructiveLabel: 'Issue a new URL',
    });
    if (!ok) return;
    warning();
    rotate.mutate(trigger.id);
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: isWebhook ? 'Delete this webhook?' : 'Delete this schedule?',
      message: `This can't be undone.${isWebhook ? ' Anything pointed at its URL will start getting 404s.' : ''}`,
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(trigger.id);
  };

  return (
    <Card style={!trigger.enabled ? { opacity: 0.7 } : undefined}>
      <View style={styles.head}>
        <View style={styles.grow}>
          <View style={styles.titleLine}>
            <Icon name={MODE_ICON[trigger.mode]} size={18} color={colors.primary} />
            <Text style={[typography.label, styles.shrink, { color: colors.text }]} numberOfLines={1}>
              {trigger.name || trigger.agent_name}
            </Text>
            <Badge label={MODE_LABEL[trigger.mode]} tone="neutral" />
          </View>
          {trigger.name ? (
            <Text style={[typography.caption, { color: colors.mutedText }]}>{trigger.agent_name}</Text>
          ) : null}
          {trigger.description ? <Text style={[typography.body, { color: colors.text }]}>{trigger.description}</Text> : null}
          {isSchedule && trigger.schedule_cron ? (
            <Text style={[typography.mono, { color: colors.mutedText }]}>{trigger.schedule_cron}</Text>
          ) : null}
          {trigger.goal ? (
            <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={2}>{trigger.goal}</Text>
          ) : null}
        </View>
        <Switch
          accessibilityRole="switch"
          accessibilityLabel={`${trigger.enabled ? 'Pause' : 'Enable'} ${trigger.name || trigger.agent_name}`}
          value={trigger.enabled}
          onValueChange={(next) => toggle.mutate({ enabled: next })}
          disabled={toggle.isPending}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>

      {isSchedule ? (
        <View style={styles.pair}>
          <View style={styles.grow}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>Next run</Text>
            <Text style={[typography.label, { color: colors.text }]}>
              {trigger.enabled ? relative(trigger.next_due_at) : 'paused'}
            </Text>
            {trigger.enabled && trigger.next_due_at ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>{absolute(trigger.next_due_at)}</Text>
            ) : null}
          </View>
          <View style={styles.grow}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>Last run</Text>
            <Text style={[typography.label, { color: colors.text }]}>{relative(trigger.last_fired_at)}</Text>
            {lastCopy ? (
              trigger.last_run_id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${lastCopy.label}, open run`}
                  onPress={() => router.push(`/more/runs/${encodeURIComponent(trigger.last_run_id ?? '')}`)}
                >
                  <Text style={[typography.caption, { color: toneColor(lastCopy.tone, colors) }]}>{lastCopy.label}</Text>
                </Pressable>
              ) : (
                <Text style={[typography.caption, { color: toneColor(lastCopy.tone, colors) }]}>{lastCopy.label}</Text>
              )
            ) : null}
          </View>
        </View>
      ) : null}

      {trigger.queued_for ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {`A scheduled run from ${absolute(trigger.queued_for)} is waiting for the current run to finish.`}
        </Text>
      ) : null}

      {isWebhook && hookUrl ? (
        <Card style={styles.hook} padded={false}>
          <View style={styles.hookInner}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>POST to this URL</Text>
            <Text selectable style={[typography.mono, { color: colors.text }]}>{hookUrl}</Text>
            <View style={styles.row}>
              <TextAction icon={copied === 'url' ? 'checkmark' : 'copy-outline'} label={copied === 'url' ? 'Copied' : 'Copy URL'} onPress={() => void copy('url')} />
              <TextAction icon={copied === 'curl' ? 'checkmark' : 'copy-outline'} label={copied === 'curl' ? 'Copied' : 'Copy test request'} onPress={() => void copy('curl')} />
            </View>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              This URL is the only credential. Anyone who has it can start a run and spend your credits.
            </Text>
          </View>
        </Card>
      ) : null}

      {isWebhook ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {`Last request: ${trigger.last_fired_at ? relative(trigger.last_fired_at) : 'never'}`}
        </Text>
      ) : null}

      {isSchedule && trigger.status !== 'ok' ? (
        <View style={[styles.status, { borderColor: tone === 'warn' ? colors.warning : colors.danger, backgroundColor: tone === 'warn' ? colors.warningBg : colors.dangerBg }]}>
          <Text style={[typography.caption, { color: tone === 'warn' ? colors.warning : colors.danger }]}>
            {trigger.status_message}
          </Text>
          <View style={styles.row}>
            {trigger.status === 'needs_permission' ? (
              <TextAction icon="shield-checkmark-outline" label="Allow it" primary onPress={() => setConfirmAllow(true)} />
            ) : null}
            {trigger.status === 'agent_paused' ? (
              <TextAction
                icon="play-outline"
                label={fix.isPending ? 'Resuming…' : 'Resume agent'}
                primary
                disabled={fix.isPending}
                onPress={() => fix.mutate({ agentId: trigger.subagent, patch: { status: 'active' } })}
              />
            ) : null}
            {trigger.status === 'self_disabled' || trigger.status === 'paused' ? (
              <TextAction icon="power-outline" label="Turn back on" primary disabled={toggle.isPending} onPress={() => toggle.mutate({ enabled: true })} />
            ) : null}
          </View>
          <ErrorText message={fix.isError ? messageOf(fix.error, 'The agent could not be changed.') : null} />
        </View>
      ) : null}

      {confirmAllow ? (
        <View style={[styles.status, { borderColor: colors.border, backgroundColor: colors.infoBg }]}>
          <Text style={[typography.caption, { color: colors.text }]}>
            {`Let ${trigger.agent_name} run when nobody is watching? It will still stop and ask before anything it's set to ask about.`}
          </Text>
          <View style={styles.row}>
            <TextAction
              icon="checkmark"
              label={fix.isPending ? 'Allowing…' : 'Allow it'}
              primary
              disabled={fix.isPending}
              onPress={() => fix.mutate({ agentId: trigger.subagent, patch: { allowUnattended: true } }, { onSuccess: () => setConfirmAllow(false) })}
            />
            <TextAction icon="close" label="Cancel" onPress={() => setConfirmAllow(false)} />
          </View>
        </View>
      ) : null}

      {outcome?.outcome === 'fired' && outcome.executionId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Started, open run"
          onPress={() => router.push(`/more/runs/${encodeURIComponent(outcome.executionId ?? '')}`)}
          style={[styles.status, { borderColor: colors.border, backgroundColor: colors.infoBg }]}
        >
          <Text style={[typography.label, { color: colors.success }]}>Started · Open run</Text>
        </Pressable>
      ) : outcome ? (
        <View style={[styles.status, { borderColor: colors.border, backgroundColor: colors.infoBg }]}>
          <Text style={[typography.label, { color: toneColor(OUTCOME_COPY[outcome.outcome].tone, colors) }]}>
            {OUTCOME_COPY[outcome.outcome].label}
          </Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{OUTCOME_COPY[outcome.outcome].hint}</Text>
        </View>
      ) : null}

      <ErrorText message={runNow.isError ? messageOf(runNow.error, 'Could not start it.') : null} />
      <ErrorText message={rotate.isError ? messageOf(rotate.error, 'The URL could not be changed.') : null} />
      <ErrorText message={remove.isError ? messageOf(remove.error, 'Could not delete it.') : null} />

      <View style={[styles.actions, { borderTopColor: colors.border }]}>
        {isSchedule ? (
          <TextAction
            icon="play"
            label={runNow.isPending ? 'Starting…' : 'Run once now'}
            primary
            disabled={runNow.isPending || !trigger.enabled}
            onPress={onRunNow}
          />
        ) : null}
        {trigger.mode !== 'event' ? <TextAction icon="create-outline" label="Edit" onPress={onEdit} /> : null}
        {isWebhook ? (
          <TextAction icon="key-outline" label="New URL" disabled={rotate.isPending} onPress={() => void onRotate()} />
        ) : null}
        <View style={styles.grow} />
        <TextAction icon="trash-outline" label="Delete" danger disabled={remove.isPending} onPress={() => void onDelete()} />
      </View>
    </Card>
  );
}

function toneColor(tone: CopyTone | 'info', colors: ReturnType<typeof useTheme>['colors']): string {
  if (tone === 'success') return colors.success;
  if (tone === 'danger') return colors.danger;
  if (tone === 'warning') return colors.warning;
  if (tone === 'info') return colors.info;
  return colors.mutedText;
}

function TextAction({
  icon,
  label,
  primary = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const tint = danger ? colors.danger : primary ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: primary ? colors.primary : colors.border,
          borderRadius: radius.md,
          opacity: disabled ? 0.45 : pressed ? pressedOpacity : 1,
        },
      ]}
    >
      <Icon name={icon} size={16} color={tint} />
      <Text style={[typography.label, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  pair: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  hook: { marginTop: spacing.md },
  hookInner: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  status: { marginTop: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
