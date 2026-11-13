import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorText } from '../../components/ErrorText';
import { LoadingState } from '../../components/LoadingState';
import { TextField } from '../../components/TextField';
import { Text } from '../../components/Text';
import { confirm } from '../../components/confirm';
import { messageOf } from '../../features/agents/format';
import { success, warning } from '../../lib/haptics';
import { useAcceptWorld, useDeleteWorld, useGenerateWorld, useSuiteWorld } from './queries';
import { typography, useTheme } from '../../theme';

/**
 * The fake situation a suite's cases share. Judge-built, and a draft until a person
 * accepts it here. A regenerated world is a new version; the old one is never edited.
 */
export function WorldPanel({ suiteId, hasAgent }: { suiteId: number; hasAgent: boolean }) {
  const { colors, spacing: sp } = useTheme();
  const world = useSuiteWorld(suiteId);
  const generate = useGenerateWorld();
  const accept = useAcceptWorld();
  const remove = useDeleteWorld();
  const [building, setBuilding] = useState(false);
  const [focus, setFocus] = useState('');
  const [showFacts, setShowFacts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (world.isPending) return <LoadingState text="Loading the test world" />;

  const live = world.data?.live ?? null;
  const draft = world.data?.draft ?? null;
  const pending = world.data?.pending ?? null;
  const generating = pending?.status === 'generating';
  const failed = pending?.status === 'failed' ? pending : null;

  const COST_NOTE =
    'The judge model invents a situation, plants facts and writes cases with known answers. This takes a few minutes and is billed to your judge key. The result is a draft, and nothing scores until you accept it.';

  const startBuild = async (fromFocus: string, count: number) => {
    const ok = await confirm({ title: 'Build a test world?', message: COST_NOTE });
    if (!ok) return;
    setError(null);
    generate.mutate(
      { suiteId, body: { focus: fromFocus.trim(), cases: Math.max(1, Math.min(25, count)) } },
      {
        onSuccess: () => {
          success();
          setBuilding(false);
          setFocus('');
        },
        onError: (err) => setError(messageOf(err, 'Could not start the world.')),
      },
    );
  };

  const acceptDraft = () => {
    if (!draft) return;
    setError(null);
    accept.mutate(draft.id, {
      onSuccess: () => success(),
      onError: (err) => setError(messageOf(err, 'Could not accept the world.')),
    });
  };

  const drop = async (id: number, label: string) => {
    const ok = await confirm({
      title: `${label}?`,
      message: 'The draft world is discarded. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    setError(null);
    remove.mutate(id, { onError: (err) => setError(messageOf(err, 'Could not delete the draft world.')) });
  };

  const facts = (w: NonNullable<typeof live>) => (w.facts ?? []).map((f) => f?.statement ?? String(f?.value ?? ''));

  return (
    <View style={{ gap: sp.sm }}>
      {generating ? (
        <Card>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Building world v{pending?.version}
            {pending?.focus ? ` — ${pending.focus}` : ''}. This takes a few minutes. You can leave this screen.
          </Text>
        </Card>
      ) : null}

      {failed ? (
        <Card>
          <View style={{ gap: sp.sm }}>
            <Text style={[typography.caption, { color: colors.danger }]}>
              World v{failed.version} could not be built: {failed.error_message || 'unknown error'}
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Try again" variant="secondary" disabled={generate.isPending}
                  onPress={() => void startBuild(failed.focus, failed.requested_cases)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Dismiss" variant="secondary" onPress={() => void drop(failed.id, 'Dismiss this failed world')} />
              </View>
            </View>
          </View>
        </Card>
      ) : null}

      {draft ? (
        <Card>
          <View style={{ gap: sp.sm }}>
            <Text style={[typography.label, { color: colors.text }]}>World v{draft.version} draft</Text>
            <Text style={[typography.caption, { color: colors.mutedText }]}>{draft.brief || 'no brief'}</Text>
            {draft.rejected?.length > 0 ? (
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                {draft.rejected.length} drafted case{draft.rejected.length === 1 ? '' : 's'} thrown out: {draft.rejected.join('; ')}
              </Text>
            ) : null}
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              Nothing scores until this is accepted, and its cases stay drafts until accepted after it.
            </Text>
            <View style={{ flexDirection: 'row', gap: sp.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Drop" variant="secondary" disabled={remove.isPending}
                  onPress={() => void drop(draft.id, `Drop world v${draft.version} draft`)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Accept world" onPress={acceptDraft} loading={accept.isPending} />
              </View>
            </View>
            <FactsToggle facts={facts(draft)} open={showFacts} onToggle={() => setShowFacts((v) => !v)} />
          </View>
        </Card>
      ) : null}

      {live ? (
        <Card>
          <View style={{ gap: sp.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.sm }}>
              <Text style={[typography.label, { color: colors.text }]}>World v{live.version}</Text>
              <Text style={[typography.caption, { color: colors.mutedText }]}>
                {live.case_count} case{live.case_count === 1 ? '' : 's'} on this version
              </Text>
            </View>
            <Text style={[typography.caption, { color: colors.mutedText }]}>{live.brief || 'no brief'}</Text>
            <FactsToggle facts={facts(live)} open={showFacts} onToggle={() => setShowFacts((v) => !v)} />
          </View>
        </Card>
      ) : !draft && !generating ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          No test world yet. Cases below test what the agent says. A world lets them test what it does.
        </Text>
      ) : null}

      {!draft && !generating ? (
        building ? (
          <Card>
            <View style={{ gap: sp.sm }}>
              <TextField
                label="Focus"
                value={focus}
                onChangeText={setFocus}
                placeholder="e.g. month-end close with duplicate invoices"
              />
              <View style={{ flexDirection: 'row', gap: sp.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" onPress={() => setBuilding(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Build it"
                    onPress={() => void startBuild(focus, 12)}
                    disabled={!hasAgent || generate.isPending}
                    loading={generate.isPending}
                  />
                </View>
              </View>
            </View>
          </Card>
        ) : (
          <Button
            title={live ? 'Regenerate world' : 'Build a test world'}
            variant="secondary"
            onPress={() => setBuilding(true)}
            disabled={!hasAgent}
          />
        )
      ) : null}

      {live && !draft && !generating ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Regenerating mints a new version. v{live.version} and its scores stay untouched.
        </Text>
      ) : null}
      {!hasAgent ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>Pick an agent first.</Text>
      ) : null}
      <ErrorText message={error ?? (world.isError ? messageOf(world.error, 'Could not load the world.') : null)} />
    </View>
  );
}

function FactsToggle({ facts, open, onToggle }: { facts: string[]; open: boolean; onToggle: () => void }) {
  const { colors, spacing: sp } = useTheme();
  if (facts.length === 0) return null;
  return (
    <View style={{ gap: sp.xs }}>
      <Button title={open ? 'Hide planted facts' : `Show ${facts.length} planted facts`} variant="secondary" onPress={onToggle} />
      {open
        ? facts.map((f, i) => (
            <Text key={i} style={[typography.caption, { color: colors.mutedText }]}>
              • {f}
            </Text>
          ))
        : null}
    </View>
  );
}
