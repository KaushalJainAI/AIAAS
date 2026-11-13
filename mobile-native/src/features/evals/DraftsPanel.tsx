import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { Icon } from '../../components/Icon';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { messageOf } from '../../features/agents/format';
import { success } from '../../lib/haptics';
import { pressedOpacity, spacing, typography, useTheme } from '../../theme';
import { CATEGORY_LABELS, caseCategory } from './format';
import { useGenerateCases, useImportRunCases, useReviewDrafts } from './queries';
import type { EvalCase, GeneratedCases } from './types';

/**
 * Test data the owner did not have to write: drafted by the judge, or imported from
 * real runs. Both land as drafts. The runner skips drafts, so nothing is scored until
 * someone accepts it here.
 */
export function DraftsPanel({ suiteId, hasAgent, drafts }: { suiteId: number; hasAgent: boolean; drafts: EvalCase[] }) {
  const { colors, spacing: s } = useTheme();
  const generate = useGenerateCases();
  const importRuns = useImportRunCases();
  const review = useReviewDrafts();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const report = (verb: string, res: GeneratedCases) => {
    const n = res.cases.length;
    const extra = [
      res.rejected?.length ? `${res.rejected.length} thrown out` : '',
      res.already_imported ? `${res.already_imported} already imported` : '',
      res.cost_usd ? `$${Number(res.cost_usd).toFixed(4)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    setNotice(`${verb} ${n} draft case${n === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}.`);
    setError(null);
  };

  const runGenerate = async () => {
    const ok = await confirm({
      title: 'Generate draft cases?',
      message:
        'The judge model drafts about 12 cases from this agent’s setup. This is billed to your judge key. Drafts are not scored until you accept them.',
    });
    if (!ok) return;
    setError(null);
    generate.mutate(
      { suiteId, body: { count: 12 } },
      {
        onSuccess: (res) => {
          success();
          report('Generated', res);
        },
        onError: (err) => {
          const message = messageOf(err, 'Could not generate cases.');
          setError(
            message.includes('accepted world')
              ? 'This suite has a test world. Build cases from the world above.'
              : message,
          );
        },
      },
    );
  };

  const runImport = () => {
    setError(null);
    importRuns.mutate(
      { suiteId, body: { limit: 20 } },
      {
        onSuccess: (res) => report('Imported', res),
        onError: (err) => setError(messageOf(err, 'Could not import runs.')),
      },
    );
  };

  const decide = (accept: number[], reject: number[]) => {
    setError(null);
    review.mutate(
      { suiteId, accept, reject },
      {
        onSuccess: (res) => {
          if (accept.length > 0) success();
          if (res.refused?.length) {
            setError(
              `${res.refused.length} case${res.refused.length === 1 ? '' : 's'} still need${res.refused.length === 1 ? 's' : ''} an accepted world. Accept the world above first.`,
            );
          }
        },
        onError: (err) => setError(messageOf(err, 'Could not save that decision.')),
      },
    );
  };

  const busy = generate.isPending || importRuns.isPending || review.isPending;

  return (
    <View style={{ gap: s.sm }}>
      <View style={{ flexDirection: 'row', gap: s.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Generate cases" variant="secondary" onPress={() => void runGenerate()} disabled={!hasAgent || busy} loading={generate.isPending} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="From recent runs" variant="secondary" onPress={runImport} disabled={!hasAgent || busy} loading={importRuns.isPending} />
        </View>
      </View>
      {!hasAgent ? <Text style={[typography.caption, { color: colors.mutedText }]}>Pick an agent first.</Text> : null}
      {notice ? <Text style={[typography.caption, { color: colors.success }]}>{notice}</Text> : null}
      <ErrorText message={error} />

      {drafts.length > 0 ? (
        <Card>
          <View style={{ gap: s.sm }}>
            <Text style={[typography.label, { color: colors.text }]}>
              {drafts.length} draft{drafts.length === 1 ? '' : 's'} to review. Not scored until accepted.
            </Text>
            <View style={{ flexDirection: 'row', gap: s.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Reject all" variant="secondary" disabled={busy} onPress={() => decide([], drafts.map((d) => d.id))} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Accept all" disabled={busy} onPress={() => decide(drafts.map((d) => d.id), [])} />
              </View>
            </View>
            {drafts.map((d) => {
              const expanded = open === d.id;
              const visibleInputs = Object.fromEntries(Object.entries(d.input_data ?? {}).filter(([k]) => !k.startsWith('__')));
              return (
                <View key={d.id} style={[styles.draft, { borderColor: colors.border }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${d.name || `Case ${d.id}`}. ${expanded ? 'Hide' : 'Show'} details`}
                    onPress={() => setOpen(expanded ? null : d.id)}
                    style={({ pressed }) => [styles.draftHead, { opacity: pressed ? pressedOpacity : 1 }]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[typography.caption, { color: colors.primary }]}>{CATEGORY_LABELS[caseCategory(d)]}</Text>
                      <Text style={[typography.label, { color: colors.text }]}>{d.name || `Case ${d.id}`}</Text>
                      <Text style={[typography.caption, { color: colors.mutedText }]} numberOfLines={expanded ? undefined : 2}>
                        {d.goal}
                      </Text>
                    </View>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />
                  </Pressable>
                  {expanded ? (
                    <View style={{ gap: s.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm }}>
                      {d.reference ? <Text style={[typography.caption, { color: colors.mutedText }]}>Good outcome: {d.reference}</Text> : null}
                      {Array.isArray(d.input_data?.['__facts__']) && (d.input_data['__facts__'] as unknown[]).length > 0 ? (
                        <Text style={[typography.caption, { color: colors.mutedText }]}>
                          Rests on facts: {(d.input_data['__facts__'] as unknown[]).map(String).join(', ')}
                        </Text>
                      ) : null}
                      {Object.keys(visibleInputs).length > 0 ? (
                        <Text style={[typography.mono, { color: colors.mutedText }]}>{JSON.stringify(visibleInputs, null, 2)}</Text>
                      ) : null}
                      <Text style={[typography.caption, { color: colors.mutedText }]}>
                        Checks: {d.graders.map((g) => g.type).join(', ') || 'none'}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.draftActions}>
                    <View style={{ flex: 1 }}>
                      <Button title="Reject" variant="secondary" disabled={busy} onPress={() => decide([], [d.id])} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Accept" disabled={busy} onPress={() => decide([d.id], [])} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  draft: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: 'hidden' },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  draftActions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
