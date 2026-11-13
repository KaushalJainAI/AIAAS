import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Switch } from '../../../../src/components/Switch';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Badge } from '../../../../src/components/Badge';
import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Screen } from '../../../../src/components/Screen';
import { Section } from '../../../../src/components/Section';
import { ListRow } from '../../../../src/components/ListRow';
import { Text } from '../../../../src/components/Text';
import { confirm } from '../../../../src/components/confirm';
import { messageOf } from '../../../../src/features/agents/format';
import { effectView, defaultsOf, REQUIREMENT_BLURB } from '../../../../src/features/tools/copy';
import { useToolCatalogue, useUpdateTools } from '../../../../src/features/tools/queries';
import type { ToolEntry, ToolSetting } from '../../../../src/features/tools/types';
import { success, warning } from '../../../../src/lib/haptics';
import { fontFamily, fontSize, spacing, typography, useTheme } from '../../../../src/theme';

/** One tool: its switch, what it does, its numeric limits, and how it is run. */
export default function ToolDetailScreen() {
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { colors, spacing: s } = useTheme();
  const catalogue = useToolCatalogue();
  const update = useUpdateTools();

  if (catalogue.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Tool' }} />
        <LoadingState text="Loading" />
      </Screen>
    );
  }

  let found: { tool: ToolEntry; categoryLabel: string } | undefined;
  for (const category of catalogue.data?.categories ?? []) {
    const tool = category.tools.find((t) => t.name === name);
    if (tool) {
      found = { tool, categoryLabel: category.label };
      break;
    }
  }

  if (!found) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Tool' }} />
        <ErrorState
          title="Tool not found"
          message={messageOf(catalogue.error, 'This tool is not in your library.')}
          onRetry={() => void catalogue.refetch()}
        />
      </Screen>
    );
  }

  const { tool, categoryLabel } = found;
  const effect = effectView(tool.effect);
  const paramEntries = tool.parameters?.properties
    ? Object.entries(tool.parameters.properties as Record<string, { description?: string; type?: string }>)
    : [];
  const required = new Set((tool.parameters?.required as string[]) ?? []);

  const setEnabled = (enabled: boolean) => {
    update.mutate({ [tool.name]: { enabled } }, { onSuccess: () => success() });
  };
  const saveConfig = (config: Record<string, number>) => {
    update.mutate({ [tool.name]: { config } }, { onSuccess: () => success() });
  };
  const resetToDefault = async () => {
    const ok = await confirm({
      title: `Reset ${tool.displayName}?`,
      message: 'Switches it back on and restores its default limits. Your changes are discarded.',
      destructiveLabel: 'Reset',
    });
    if (!ok) return;
    warning();
    update.mutate({ [tool.name]: { enabled: true, config: defaultsOf(tool) } }, { onSuccess: () => success() });
  };

  const status = tool.unserved
    ? 'Not available yet'
    : tool.locked
      ? 'Always available'
      : tool.enabled
        ? 'Available to your assistant'
        : 'Switched off';
  const statusHint = tool.unserved
    ? 'Nothing serves this tool yet, whatever the switch says. No run is ever handed it.'
    : tool.locked
      ? 'The assistant is told to call this by name when a result is too large to replay, so it cannot be switched off.'
      : tool.enabled
        ? 'Offered to every agent whose grants cover it, and in chat.'
        : 'Not offered to any agent, and refused if one asks for it anyway.';
  const switchDisabled = update.isPending || tool.locked || tool.unserved;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: tool.displayName }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.badges}>
          <Badge label={categoryLabel} tone="neutral" />
          <Badge label={effect.label} tone={effect.tone} />
          {tool.parallel ? <Badge label="Runs in parallel" tone="neutral" /> : null}
          {tool.sensitive ? <Badge label="Asks before running" tone="primary" /> : null}
        </View>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{tool.name}</Text>

        <Card>
          <View style={styles.statusRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[typography.label, { color: colors.text }]}>{status}</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>{statusHint}</Text>
            </View>
            <Switch
              accessibilityLabel={`${tool.enabled ? 'Turn off' : 'Turn on'} ${tool.displayName}`}
              accessibilityRole="switch"
              value={tool.enabled}
              disabled={switchDisabled}
              onValueChange={setEnabled}
              trackColor={{ false: colors.border, true: colors.primary }}

            />
          </View>
        </Card>
        <ErrorText message={update.isError ? "That change didn't save. Try again." : null} />

        <Section title="What it does">
          <ListRow title={tool.description || 'No description.'} chevron={false} />
        </Section>

        {tool.settings.length > 0 ? (
          <SettingsEditor
            key={JSON.stringify(tool.config)}
            tool={tool}
            onSave={saveConfig}
            busy={update.isPending}
          />
        ) : null}

        <Section title="Effect and availability">
          <ListRow title={effect.label} subtitle={effect.blurb} chevron={false} />
          <ListRow
            title={tool.alwaysAvailable ? 'Always on' : tool.requires ? 'Conditional' : 'By grant'}
            subtitle={
              tool.requires
                ? (REQUIREMENT_BLURB[tool.requires] ?? 'Has a precondition.')
                : tool.alwaysAvailable
                  ? 'Offered whatever an agent was granted.'
                  : 'Offered to agents granted this tool group.'
            }
            chevron={false}
          />
        </Section>

        {paramEntries.length > 0 ? (
          <Section title="Parameters">
            {paramEntries.map(([key, def]) => (
              <ListRow
                key={key}
                title={`${key}${required.has(key) ? ' *' : ''}`}
                subtitle={(def as { description?: string }).description ?? (def as { type?: string }).type ?? ''}
                chevron={false}
              />
            ))}
          </Section>
        ) : null}

        {tool.customized ? (
          <Button title="Reset to default" variant="secondary" onPress={() => void resetToDefault()} loading={update.isPending} />
        ) : null}

        <Text style={[typography.caption, { color: colors.mutedText }]}>
          The switch here is workspace-wide. Which agents may use this tool is set per agent, in the agent builder.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** The numeric limits, as an editable draft. Remounted (by `key`) when the stored values change. */
function SettingsEditor({
  tool,
  onSave,
  busy,
}: {
  tool: ToolEntry;
  onSave: (config: Record<string, number>) => void;
  busy: boolean;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(tool.settings.map((st) => [st.key, String(tool.config[st.key] ?? st.default)])),
  );
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = (st: ToolSetting): number | null => {
    const text = draft[st.key] ?? '';
    if (text.trim() === '') return null;
    const n = Number(text);
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
  };
  const outOfRange = (st: ToolSetting) => {
    const n = parsed(st);
    return n === null || n < st.minimum || n > st.maximum;
  };
  const dirty = tool.settings.some((st) => parsed(st) !== (tool.config[st.key] ?? st.default));
  const atDefaults = tool.settings.every((st) => parsed(st) === st.default);
  const anyBad = tool.settings.some(outOfRange);

  const save = () => {
    if (anyBad) {
      setProblem('Each limit must be a whole number inside its range.');
      return;
    }
    setProblem(null);
    const config: Record<string, number> = {};
    for (const st of tool.settings) config[st.key] = parsed(st) as number;
    onSave(config);
  };

  return (
    <View style={{ gap: s.sm }}>
      <Section title="Settings">
        {tool.settings.map((st) => (
          <View key={st.key} style={[styles.setting, { gap: s.xs }]}>
            <View style={styles.settingHead}>
              <Text style={[typography.label, styles.settingLabel, { color: colors.text }]}>{st.label}</Text>
              <TextInput
                accessibilityLabel={st.label}
                keyboardType="number-pad"
                value={draft[st.key] ?? ''}
                onChangeText={(text) => setDraft((d) => ({ ...d, [st.key]: text.replace(/[^0-9-]/g, '') }))}
                style={[
                  styles.numberInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                    borderColor: outOfRange(st) ? colors.danger : colors.border,
                    borderRadius: r.md,
                    fontFamily: fontFamily.regular,
                  },
                ]}
              />
            </View>
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              {st.help} {st.minimum.toLocaleString()} to {st.maximum.toLocaleString()}
              {st.unit ? ` ${st.unit}` : ''}, default {st.default.toLocaleString()}.
            </Text>
          </View>
        ))}
      </Section>
      <ErrorText message={problem} />
      <View style={styles.settingActions}>
        <View style={{ flex: 1 }}>
          <Button title={busy ? 'Saving' : 'Save settings'} onPress={save} disabled={!dirty || busy || anyBad} loading={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Defaults"
            variant="secondary"
            onPress={() => setDraft(Object.fromEntries(tool.settings.map((st) => [st.key, String(st.default)])))}
            disabled={atDefaults || busy}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  setting: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  settingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  settingLabel: { flex: 1 },
  numberInput: {
    minWidth: 96,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    textAlign: 'right',
    fontSize: fontSize.md,
  },
  settingActions: { flexDirection: 'row', gap: spacing.sm },
});
