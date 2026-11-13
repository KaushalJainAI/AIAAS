import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { Chip, ChipRow } from '../runs/Chips';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import {
  DAY_NAMES,
  HOUR_INTERVALS,
  MINUTE_INTERVALS,
  describe as describeLocally,
  localZone,
  toCron,
  type ScheduleKind,
  type ScheduleSpec,
} from './cron';
import { absolute, fromLocalText } from './format';
import type { ScheduleDraft } from './draft';
import { useDebounced } from './useDebounced';
import { useSchedulePreview } from './queries';
import type { OverlapPolicy, PreviewInput } from './types';

/** How long to sit still before asking the server. Long enough that holding a key does not fire a request per repeat. */
const PREVIEW_DEBOUNCE_MS = 350;

/** The repeat choices, in the order people think them, with the web's plain labels. */
const REPEAT_ORDER: { kind: ScheduleKind; label: string }[] = [
  { kind: 'daily', label: 'Every day' },
  { kind: 'weekdays', label: 'Weekdays' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'monthly', label: 'Monthly' },
  { kind: 'hourly', label: 'Every few hours' },
  { kind: 'minutes', label: 'Every few minutes' },
  { kind: 'custom', label: 'Custom' },
];

const OVERLAP_COPY: Record<OverlapPolicy, { label: string; hint: string }> = {
  skip: { label: 'Skip this firing', hint: 'Leave the running one alone and wait for the next slot.' },
  queue: {
    label: 'Run after the current one',
    hint: 'Hold the firing and start it as soon as the agent is free. Dropped if it waits more than six hours.',
  },
  cancel: {
    label: 'Cancel the running one',
    hint: 'Stop what is in flight — including a run paused for your approval — and start fresh.',
  },
};

const OVERLAP_ORDER: OverlapPolicy[] = ['skip', 'queue', 'cancel'];

/** Zones people pick most. Anything else can be typed in the field. */
function commonZones(): string[] {
  const list = ['UTC', localZone(), 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];
  return [...new Set(list)];
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface Props {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  /** False means every firing will be refused; the editor says so and offers the fix. */
  agentAllowsUnattended: boolean;
  onAllow: () => void;
  allowing: boolean;
  allowError: string | null;
}

/**
 * The schedule builder: a repeat chooser that writes a cron, the server's own
 * reading of it, and the next few dates in the reader's clock. The server's
 * description replaces the local one once it arrives, because the sweep runs
 * the server's reading, not ours.
 */
export function ScheduleEditor({ value, onChange, agentAllowsUnattended, onAllow, allowing, allowError }: Props) {
  const { colors } = useTheme();
  const cron = toCron(value.spec);
  const startsIso = fromLocalText(value.startsText);
  const endsIso = fromLocalText(value.endsText);
  const datesOk = startsIso !== undefined && endsIso !== undefined;
  const zones = useMemo(() => commonZones(), []);

  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const setSpec = (patch: Partial<ScheduleSpec>) => set({ spec: { ...value.spec, ...patch } });

  // The server's reading. Debounced, and only asked for a usable expression with usable dates.
  const input: PreviewInput | null =
    cron.trim() && datesOk
      ? {
          cron,
          timezone: value.timezone,
          count: 3,
          starts_at: startsIso ?? null,
          ends_at: endsIso ?? null,
        }
      : null;
  const key = input ? JSON.stringify(input) : '';
  const settledKey = useDebounced(key, PREVIEW_DEBOUNCE_MS);
  const settledInput = useMemo<PreviewInput | null>(
    () => (settledKey ? (JSON.parse(settledKey) as PreviewInput) : null),
    [settledKey],
  );
  const preview = useSchedulePreview(settledInput);
  const shown = settledInput ? preview.data : undefined;
  const checking = key !== settledKey || preview.isFetching;

  const local = describeLocally(value.spec, value.timezone);
  const reading = shown?.description || local;

  // The time field is free text while typing; it is applied once it parses.
  const [timeText, setTimeText] = useState<string | null>(null);
  const formattedTime = `${pad(value.spec.hour)}:${pad(value.spec.minute)}`;
  const timeValid = timeText === null || /^([01]?\d|2[0-3]):[0-5]\d$/.test(timeText.trim());

  const onTimeChange = (text: string) => {
    setTimeText(text);
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
    if (match) setSpec({ hour: Number(match[1]), minute: Number(match[2]) });
  };

  const toggleDay = (day: number) => {
    const on = value.spec.weekdays.includes(day);
    const weekdays = on
      ? value.spec.weekdays.filter((d) => d !== day)
      : [...value.spec.weekdays, day].sort((a, b) => a - b);
    setSpec({ weekdays });
  };

  const kind = value.spec.kind;
  const showTime = kind !== 'minutes' && kind !== 'hourly' && kind !== 'custom';

  return (
    <View style={{ gap: spacing.lg }}>
      {!agentAllowsUnattended ? (
        <Card style={{ ...styles.warn, borderColor: colors.danger }}>
          <Text style={[typography.caption, { color: colors.danger }]}>
            This agent is not allowed to run with nobody watching, so every firing of this schedule will be refused.
          </Text>
          <Button title="Allow it" variant="secondary" onPress={onAllow} loading={allowing} />
          <ErrorText message={allowError} />
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.text }]}>Repeats</Text>
        <ChipRow>
          {REPEAT_ORDER.map(({ kind: k, label }) => (
            <Chip key={k} label={label} selected={kind === k} onPress={() => setSpec({ kind: k })} />
          ))}
        </ChipRow>
      </View>

      {kind === 'minutes' || kind === 'hourly' ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.text }]}>
            {kind === 'minutes' ? 'Every (minutes)' : 'Every (hours)'}
          </Text>
          <ChipRow>
            {(kind === 'minutes' ? MINUTE_INTERVALS : HOUR_INTERVALS).map((n) => (
              <Chip key={n} label={String(n)} selected={value.spec.interval === n} onPress={() => setSpec({ interval: n })} />
            ))}
          </ChipRow>
        </View>
      ) : null}

      {kind === 'hourly' ? (
        <TextField
          label="Minutes past the hour"
          value={String(value.spec.minute)}
          onChangeText={(text) => {
            const n = Number(text.replace(/[^0-9]/g, ''));
            setSpec({ minute: Number.isFinite(n) ? Math.min(59, n) : 0 });
          }}
          keyboardType="number-pad"
          maxLength={2}
        />
      ) : null}

      {kind === 'weekly' ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.text }]}>On these days</Text>
          <ChipRow>
            {DAY_NAMES.map((name, day) => (
              <Chip
                key={name}
                label={name}
                selected={value.spec.weekdays.includes(day)}
                accessibilityLabel={name}
                onPress={() => toggleDay(day)}
              />
            ))}
          </ChipRow>
          {value.spec.weekdays.length === 0 ? (
            <Text style={[typography.caption, { color: colors.warning }]}>Pick at least one day, or it defaults to Monday.</Text>
          ) : null}
        </View>
      ) : null}

      {kind === 'monthly' ? (
        <TextField
          label="Day of the month (1–31)"
          value={String(value.spec.monthday)}
          onChangeText={(text) => {
            const n = Number(text.replace(/[^0-9]/g, ''));
            setSpec({ monthday: Number.isFinite(n) ? Math.min(31, n) : 1 });
          }}
          keyboardType="number-pad"
          maxLength={2}
        />
      ) : null}

      {showTime ? (
        <TextField
          label="At (24-hour, HH:MM)"
          value={timeText ?? formattedTime}
          onChangeText={onTimeChange}
          onBlur={() => setTimeText(null)}
          placeholder="09:00"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          error={timeValid ? null : 'Use HH:MM, for example 09:30'}
        />
      ) : null}

      {kind === 'custom' ? (
        <TextField
          label="Cron expression"
          value={value.spec.expression}
          onChangeText={(text) => setSpec({ expression: text })}
          placeholder="0 9 * * 1"
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}

      <Card style={{ gap: spacing.sm }}>
        <View style={styles.readingRow}>
          <Icon name="calendar-outline" size={18} color={colors.primary} />
          <Text style={[typography.label, styles.grow, { color: colors.text }]}>
            {reading || (checking ? 'Reading…' : 'Nothing scheduled yet')}
          </Text>
        </View>
        {shown?.valid && shown.upcoming.length > 0 ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>{`Next: ${absolute(shown.upcoming[0])}`}</Text>
        ) : null}
        <Text style={[typography.mono, { color: colors.mutedText }]}>{cron || '—'}</Text>
        {shown && !shown.valid ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{shown.error}</Text>
        ) : null}
        {shown?.valid && shown.upcoming.length > 0 ? (
          <View style={{ gap: 2 }}>
            <Text style={[typography.caption, { color: colors.mutedText }]}>Next runs, in your time</Text>
            {shown.upcoming.map((iso) => (
              <View key={iso} style={styles.slot}>
                <Icon name="checkmark" size={14} color={colors.success} />
                <Text style={[typography.caption, { color: colors.text }]}>{absolute(iso)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {!datesOk ? (
          <Text style={[typography.caption, { color: colors.danger }]}>Start or end date is not valid. Use YYYY-MM-DD HH:MM.</Text>
        ) : null}
      </Card>

      <TextField
        label="Goal (optional)"
        value={value.goal}
        onChangeText={(text) => set({ goal: text })}
        placeholder="What should it do each time this fires? Falls back to the agent's own brief."
        multiline
        style={{ minHeight: 72, textAlignVertical: 'top' }}
      />

      <TextField
        label="Name (optional)"
        value={value.name}
        onChangeText={(text) => set({ name: text })}
        placeholder="Weekday briefing"
        maxLength={80}
      />

      <View style={{ gap: spacing.sm }}>
        <TextField
          label="Timezone"
          value={value.timezone}
          onChangeText={(text) => set({ timezone: text.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ChipRow>
          {zones.map((zone) => (
            <Chip key={zone} label={zone} selected={value.timezone === zone} onPress={() => set({ timezone: zone })} />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: spacing.sm }}>
        <TextField
          label="Starts (optional)"
          value={value.startsText}
          onChangeText={(text) => set({ startsText: text })}
          placeholder="YYYY-MM-DD HH:MM"
          autoCapitalize="none"
          error={startsIso === undefined ? 'Use YYYY-MM-DD HH:MM' : null}
        />
        <TextField
          label="Ends (optional)"
          value={value.endsText}
          onChangeText={(text) => set({ endsText: text })}
          placeholder="YYYY-MM-DD HH:MM"
          autoCapitalize="none"
          error={endsIso === undefined ? 'Use YYYY-MM-DD HH:MM' : null}
        />
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          A schedule outside its window is not broken, just not live. It waits before its start date and switches itself off after its end date.
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.text }]}>If the previous run is still going</Text>
        {OVERLAP_ORDER.map((id) => (
          <OverlapOption
            key={id}
            label={OVERLAP_COPY[id].label}
            hint={OVERLAP_COPY[id].hint}
            selected={value.overlap === id}
            onPress={() => set({ overlap: id })}
          />
        ))}
      </View>
    </View>
  );
}

function OverlapOption({ label, hint, selected, onPress }: { label: string; hint: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.infoBg : colors.surface,
          opacity: pressed ? pressedOpacity : 1,
        },
      ]}
    >
      <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.mutedText} />
      <View style={styles.grow}>
        <Text style={[typography.label, { color: colors.text }]}>{label}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  warn: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  slot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
});

