/**
 * Creating an agent by describing it. Describe, then questions, then the proposal
 * for approval, then create. Mirrors better-n8n-frontend/src/pages/AgentCreateWizard.tsx:
 * both wizard calls are read-only, and creation goes through the ordinary create
 * call so the same serializer checks it. Nothing exists until the proposal is approved.
 */
import { useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { evalsApi } from '../../evals/api';
import { messageOf } from '../../agents/format';
import { success, warning } from '../../../lib/haptics';
import { spacing, typography, useTheme } from '../../../theme';
import { AUTONOMY_COPY, GRANT_ITEMS } from '../config';
import { refusalFrom } from '../refusal';
import { wizardCreateBody, STARTER_EVAL_TEMPLATES } from '../payload';
import { useCreateAgent, useWizardPropose, useWizardQuestions } from '../queries';
import type { AgentConfig, WizardProposal, WizardQuestion } from '../types';
import { Chips, Field, Note, Notice, Panel, TextBox } from '../ui';

type Step = 'describe' | 'questions' | 'proposal' | 'done';

const STARTER_LABEL: Record<(typeof STARTER_EVAL_TEMPLATES)[number], string> = {
  research: 'Research',
  analyst: 'Analyst',
  files: 'Files',
  support: 'Support',
  code: 'Code',
};

export function AgentWizard() {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('describe');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<WizardQuestion[]>([]);
  const [memoryHints, setMemoryHints] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<WizardProposal | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [createdName, setCreatedName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [evalNote, setEvalNote] = useState<string | null>(null);

  const ask = useWizardQuestions();
  const propose = useWizardPropose();
  const create = useCreateAgent();
  const [cloning, setCloning] = useState<string | null>(null);

  const onAsk = async () => {
    setError(null);
    try {
      const data = await ask.mutateAsync(description);
      setQuestions(data.questions);
      setMemoryHints(data.memory_hints);
      setStep('questions');
    } catch (err) {
      setError(messageOf(err, 'Could not load questions.'));
    }
  };

  const onPropose = async () => {
    setError(null);
    try {
      const data = await propose.mutateAsync({ description, answers });
      setProposal(data);
      setStep('proposal');
    } catch (err) {
      setError(messageOf(err, 'Could not build a proposal.'));
    }
  };

  const onCreate = async () => {
    if (!proposal) return;
    setError(null);
    try {
      const agent = await create.mutateAsync(
        wizardCreateBody(description, answers, proposal.config as Partial<AgentConfig>),
      );
      success();
      setCreatedId(agent.id);
      setCreatedName(agent.name);
      setStep('done');
    } catch (err) {
      warning();
      setError(refusalFrom(err, 'Creation was refused. Check the proposal.').summary);
    }
  };

  const onStarter = async (template: string) => {
    setCloning(template);
    setEvalNote(null);
    try {
      const suite = await evalsApi.cloneStarter({ template, agent_id: createdId ?? undefined });
      success();
      setEvalNote(`Starter eval "${suite.name}" created.`);
      router.push('/more/evals');
    } catch (err) {
      warning();
      setEvalNote(messageOf(err, 'Could not clone the starter eval.'));
    } finally {
      setCloning(null);
    }
  };

  const busy = ask.isPending || propose.isPending || create.isPending;

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>Create an agent</Text>
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Describe the job. The orchestrator asks what it needs, proposes the config, and you approve before anything exists.
          </Text>
        </View>

        {error ? <Notice text={error} /> : null}

        {step === 'describe' ? (
          <Panel>
            <Field label="What should this agent do?">
              <TextBox
                accessibilityLabel="What should this agent do?"
                multiline
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Read invoices from Gmail every Monday and chase anything overdue by 30 days"
              />
            </Field>
            <Button
              title="Ask me what it needs"
              onPress={() => void onAsk()}
              loading={ask.isPending}
              disabled={!description.trim() || busy}
            />
            <Button title="Start blank" variant="secondary" onPress={() => router.push('/agents/new/edit')} disabled={busy} />
            <Button title="From a template" variant="secondary" onPress={() => router.push('/more/explore')} disabled={busy} />
          </Panel>
        ) : null}

        {step === 'questions' ? (
          <Panel>
            {memoryHints.length > 0 ? <Note>{memoryHints.join(' · ')}</Note> : null}
            {questions.map((q) => (
              <Field key={q.id} label={q.text}>
                {q.why ? <Note>{q.why}</Note> : null}
                {q.options && q.options.length > 0 ? (
                  <Chips<string>
                    options={q.options.map((o) => ({ value: o, label: o }))}
                    value={answers[q.id] ?? ''}
                    onChange={(v) => setAnswers({ ...answers, [q.id]: v })}
                  />
                ) : (
                  <TextBox
                    accessibilityLabel={q.text}
                    value={answers[q.id] ?? ''}
                    onChangeText={(v) => setAnswers({ ...answers, [q.id]: v })}
                    placeholder="Type your answer"
                  />
                )}
              </Field>
            ))}
            <Button title="Propose the agent" onPress={() => void onPropose()} loading={propose.isPending} disabled={busy} />
            <Button title="Back" variant="secondary" onPress={() => setStep('describe')} disabled={busy} />
          </Panel>
        ) : null}

        {step === 'proposal' && proposal ? (
          <Panel>
            <Text style={[typography.label, { color: colors.text }]}>Proposal: approve before anything exists</Text>
            {proposal.explanations.map((line) => (
              <Note key={line}>· {line}</Note>
            ))}
            {proposal.warnings.map((w) => (
              <Notice key={w} text={w} tone="warning" />
            ))}
            <ProposalSummary config={proposal.config as Partial<AgentConfig>} answers={answers} description={description} />
            <Button title="Approve and create" onPress={() => void onCreate()} loading={create.isPending} disabled={busy} />
            <Button title="Back" variant="secondary" onPress={() => setStep('questions')} disabled={busy} />
          </Panel>
        ) : null}

        {step === 'done' ? (
          <Panel>
            <Text style={[typography.label, { color: colors.text }]}>
              {createdName ? `${createdName} is set up.` : 'Installed.'} Now prove it works.
            </Text>
            <Note>
              Clone the starter eval for this agent and run it for a 0 to 100 scorecard. Giving up scores 0;
              hallucinations and out-of-scope tools score minus.
            </Note>
            {STARTER_EVAL_TEMPLATES.map((t) => (
              <Button
                key={t}
                title={`Clone ${STARTER_LABEL[t]} starter`}
                variant="secondary"
                loading={cloning === t}
                disabled={cloning !== null}
                onPress={() => void onStarter(t)}
              />
            ))}
            {evalNote ? <Note>{evalNote}</Note> : null}
            {createdId != null ? (
              <Button title="Open the agent" onPress={() => router.replace(`/agents/${createdId}`)} />
            ) : null}
          </Panel>
        ) : null}

        {busy && !error ? <ActivityIndicator color={colors.primary} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** The proposal in plain words: the settings a person decides on, not the raw config. */
function ProposalSummary({ config, answers, description }: {
  config: Partial<AgentConfig>;
  answers: Record<string, string>;
  description: string;
}) {
  const { colors } = useTheme();
  const name = String(answers.name || config.name || description.slice(0, 60));
  const tools = GRANT_ITEMS.filter((g) => config.tools?.[g.key]).map((g) => g.label);
  const rows: [string, string][] = [
    ['Name', name],
    ['Model', config.model || 'Account default'],
    ['Autonomy', config.autonomy ? AUTONOMY_COPY[config.autonomy].label : 'Ask before changes'],
    ['Tools', tools.length ? tools.join(', ') : 'None'],
    ['Connections', config.connectors?.length ? `${config.connectors.length} chosen` : 'Every connection'],
    ['Schedule', config.schedule ? config.schedule : 'None: runs when asked'],
  ];
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ gap: 2 }}>
          <Text style={[typography.caption, { color: colors.mutedText }]}>{label}</Text>
          <Text style={[typography.body, { color: colors.text }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
