import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../../../src/components/Text';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../../src/components/Button';
import { Card } from '../../../../../src/components/Card';
import { ErrorState } from '../../../../../src/components/ErrorState';
import { ErrorText } from '../../../../../src/components/ErrorText';
import { Icon } from '../../../../../src/components/Icon';
import { LoadingState } from '../../../../../src/components/LoadingState';
import { Screen } from '../../../../../src/components/Screen';
import { TextField } from '../../../../../src/components/TextField';
import { confirm } from '../../../../../src/components/confirm';
import { ChoicePicker, type ChoiceOption } from '../../../../../src/features/explore/ChoicePicker';
import { GroupHeader } from '../../../../../src/features/explore/GroupHeader';
import {
  AUTONOMY_COPY,
  FILE_ACCESS_COPY,
  grantedLines,
  isToolRequirement,
  isUnavailable,
  limitsOf,
  requirementNoun,
} from '../../../../../src/features/explore/copy';
import { useInstallTemplate, useTemplate } from '../../../../../src/features/explore/queries';
import type { AgentTemplate, RequirementChoices, TemplateRequirement } from '../../../../../src/features/explore/types';
import { messageOf } from '../../../../../src/features/agents/format';
import { success } from '../../../../../src/lib/haptics';
import { fontSize, radius, spacing, typography, useTheme } from '../../../../../src/theme';

/** The choices an install starts with: a single candidate is chosen, a tool with none of yours takes the author's copy. */
function initialChoices(template: AgentTemplate): RequirementChoices {
  const out: RequirementChoices = {};
  for (const req of template.requirements) {
    if (req.candidates.length === 1) out[req.key] = req.candidates[0].id;
    else if (isToolRequirement(req.type) && req.candidates.length === 0 && req.snapshot) out[req.key] = 'install';
  }
  return out;
}

/** Where a requirement with no candidates is made, in words the mobile app can point at. */
const MISSING_HINT: Record<string, string> = {
  connector: 'Add one under More, then Connections.',
  knowledge_base: 'Add one under More, then Knowledge bases.',
};

/** Install one entry as your own agent. Pick what it should use, then install. */
export default function ExploreInstallScreen() {
  const { slug = '' } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const template = useTemplate(slug);

  if (template.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Install' }} />
        <LoadingState text="Loading" />
      </Screen>
    );
  }
  if (template.isError || !template.data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Install' }} />
        <ErrorState message={messageOf(template.error, 'This entry is not available to you.')} />
      </Screen>
    );
  }

  return <InstallForm key={template.data.slug} template={template.data} onDone={(id) => router.replace(`/agents/${id}`)} colors={colors} spacing={s} />;
}

function InstallForm({
  template,
  onDone,
  colors,
  spacing: s,
}: {
  template: AgentTemplate;
  onDone: (agentId: number) => void;
  colors: ReturnType<typeof useTheme>['colors'];
  spacing: typeof spacing;
}) {
  const [name, setName] = useState(template.name);
  const [choices, setChoices] = useState<RequirementChoices>(() => initialChoices(template));
  const [picking, setPicking] = useState<TemplateRequirement | null>(null);
  const install = useInstallTemplate();

  const unavailable = isUnavailable(template);
  const missing = template.requirements.filter((r) => !r.optional && choices[r.key] === undefined);
  const { autonomy, fileAccess, spendCap, schedule } = limitsOf(template);
  const grants = grantedLines(template);
  const canInstall = name.trim().length > 0 && missing.length === 0 && !unavailable && !install.isPending;

  const setChoice = (key: string, value: string) => {
    setChoices((prev) => {
      const next = { ...prev };
      if (value === '') delete next[key];
      else if (value === 'install') next[key] = 'install';
      else next[key] = Number(value);
      return next;
    });
  };

  const submit = () => {
    if (!canInstall) return;
    install.mutate(
      { slug: template.slug, body: { name: name.trim(), requirements: choices } },
      {
        onSuccess: async (agent) => {
          success();
          const needed = agent.credentials_needed ?? [];
          if (needed.length > 0) {
            // Tools arrived, credentials did not: they never travel. Say what to link.
            await confirm({
              title: `${agent.name} installed`,
              message: `Link your own credential for ${needed.map((n) => `"${n.tool}" (${n.slug})`).join(', ')} under Credentials before it can use those tools.`,
              cancelLabel: 'Later',
              destructiveLabel: 'OK',
            });
          }
          onDone(agent.id);
        },
      },
    );
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: `Install ${template.name}` }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        <Text style={[typography.body, { color: colors.mutedText }]}>{template.description || template.tagline}</Text>

        <TextField label="Name" value={name} onChangeText={setName} placeholder="Name for your copy" autoCapitalize="words" />

        <GroupHeader title="This agent will be able to" />
        <Card>
          {grants.length === 0 ? (
            <Text style={[typography.body, { color: colors.mutedText }]}>
              Nothing beyond answering you. It has no tools at all.
            </Text>
          ) : (
            <View style={{ gap: s.sm }}>
              {grants.map((line) => (
                <View key={line} style={styles.line}>
                  <Icon name="checkmark" size={16} color={colors.primary} />
                  <Text style={[typography.body, styles.lineText, { color: colors.text }]}>{line}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {template.requirements.length > 0 ? (
          <>
            <GroupHeader title="What it should use" footer="Pick from your own rows. Credentials never travel with an install." />
            <View style={{ gap: s.md }}>
              {template.requirements.map((req) => {
                const current = choices[req.key];
                const noOptions = req.candidates.length === 0 && !req.snapshot;
                const label =
                  current === 'install'
                    ? "Author's copy"
                    : current !== undefined
                      ? (req.candidates.find((c) => c.id === current)?.label ?? `#${current}`)
                      : 'Choose…';
                return (
                  <Card key={req.key}>
                    <View style={{ gap: s.xs }}>
                      <View style={styles.reqHead}>
                        <Text style={[typography.label, styles.reqTitle, { color: colors.text }]}>
                          {req.label}
                          {req.optional ? <Text style={{ color: colors.mutedText }}> · optional</Text> : null}
                        </Text>
                        <Text style={[typography.caption, { color: colors.mutedText }]}>{requirementNoun(req.type)}</Text>
                      </View>
                      <Text style={[typography.caption, { color: colors.mutedText }]}>{req.why}</Text>

                      {noOptions ? (
                        <Text style={[typography.caption, { color: colors.danger }]}>
                          You have no {requirementNoun(req.type).toLowerCase()} to use here yet.{' '}
                          {MISSING_HINT[req.type] ?? ''}
                        </Text>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${req.label}: ${label}. Change`}
                          onPress={() => setPicking(req)}
                          style={({ pressed }) => [
                            styles.picker,
                            { borderColor: colors.border, backgroundColor: colors.inputBackground, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <Text numberOfLines={1} style={[typography.body, styles.pickerText, { color: current === undefined ? colors.mutedText : colors.text }]}>
                            {label}
                          </Text>
                          <Icon name="chevron-down" size={18} color={colors.mutedText} />
                        </Pressable>
                      )}

                      {isToolRequirement(req.type) && current === 'install' && req.snapshot?.auth_shape?.needs ? (
                        <Text style={[typography.caption, { color: colors.mutedText }]}>
                          Arrives unauthenticated. You will link your own {req.snapshot.auth_shape.needs.slug} credential
                          after installing.
                        </Text>
                      ) : null}
                    </View>
                  </Card>
                );
              })}
            </View>
          </>
        ) : null}

        <GroupHeader title="Limits" />
        <Card>
          <View style={{ gap: s.sm }}>
            <Limit icon="shield-checkmark-outline" text={AUTONOMY_COPY[autonomy].hint} />
            <Limit icon="globe-outline" text="Sandboxed code cannot reach the network." />
            <Limit icon="folder-outline" text={FILE_ACCESS_COPY[fileAccess].hint} />
            <Limit icon="cash-outline" text={`Spends at most ₹${spendCap} a month.`} />
            {schedule ? (
              <Limit icon="time-outline" text={`Runs on its own schedule (${schedule}) in your timezone, so it may run with nobody watching.`} />
            ) : null}
          </View>
        </Card>

        {unavailable ? (
          <Text style={[typography.body, { color: colors.warning }]}>
            {template.unavailable_reason ?? 'This template cannot run on this server.'}
          </Text>
        ) : null}
        {missing.length > 0 ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Choose {missing.map((m) => m.label).join(', ')} to continue.
          </Text>
        ) : null}
        <ErrorText message={install.isError ? messageOf(install.error, 'Could not install this template.') : null} />

        <Button title="Install" onPress={submit} disabled={!canInstall} loading={install.isPending} />
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          You can change any of this afterwards in the builder.
        </Text>
      </ScrollView>

      {picking ? (
        <ChoicePicker<string>
          visible
          title={picking.label}
          value={choices[picking.key] === undefined ? '' : String(choices[picking.key])}
          options={pickerOptions(picking)}
          onSelect={(value) => setChoice(picking.key, value)}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Screen>
  );
}

function pickerOptions(req: TemplateRequirement): ChoiceOption<string>[] {
  const options: ChoiceOption<string>[] = [];
  if (req.optional) options.push({ value: '', label: 'Skip this one', hint: 'It is optional.' });
  if (req.snapshot) {
    options.push({
      value: 'install',
      label: `Install author's copy of "${req.label}"`,
      hint: 'Arrives without your credentials.',
    });
  }
  for (const c of req.candidates) {
    options.push({
      value: String(c.id),
      label: c.label,
      hint: c.doc_count != null ? `${c.doc_count} documents` : undefined,
    });
  }
  return options;
}

function Limit({ icon, text }: { icon: Parameters<typeof Icon>[0]['name']; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} color={colors.mutedText} />
      <Text style={[typography.body, styles.lineText, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineText: { flex: 1 },
  reqHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  reqTitle: { flex: 1, fontSize: fontSize.md },
  picker: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pickerText: { flex: 1 },
});
