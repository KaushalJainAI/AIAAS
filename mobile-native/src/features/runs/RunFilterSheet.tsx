import type { ReactNode } from 'react';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import type { Agent } from '../agents/types';
import { spacing, typography, useTheme } from '../../theme';
import { Chip, ChipRow } from './Chips';
import { CALLER_LABEL, FAILURE_LABEL, STATUS_FILTER_LABEL } from './format';
import type { RunListFilters } from './queries';
import type { FailureCategory, RunCaller, RunStatus } from './types';

interface Props {
  visible: boolean;
  onClose: () => void;
  value: RunListFilters;
  agents: Agent[];
  onApply: (next: RunListFilters) => void;
}

const STATUSES = Object.keys(STATUS_FILTER_LABEL) as RunStatus[];
const CALLERS = Object.keys(CALLER_LABEL) as RunCaller[];
const FAILURES = Object.keys(FAILURE_LABEL) as FailureCategory[];

/** The four filters the run list takes. Anything unset means "any". */
export function RunFilterSheet({ visible, onClose, value, agents, onApply }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filter runs">
      {visible ? <FilterForm value={value} agents={agents} onApply={onApply} onClose={onClose} /> : null}
    </Sheet>
  );
}

function FilterForm({ value, agents, onApply, onClose }: Omit<Props, 'visible' | 'onClose'> & { onClose: () => void }) {
  const { height } = useWindowDimensions();
  const [status, setStatus] = useState<RunStatus | undefined>(value.status);
  const [caller, setCaller] = useState<RunCaller | undefined>(value.caller);
  const [agentId, setAgentId] = useState<number | undefined>(value.workflow_id);
  const [failure, setFailure] = useState<FailureCategory | undefined>(value.failure_category);

  const visibleAgents = agents.filter((a) => a.status !== 'archived');

  const apply = () => {
    onApply({
      ...value,
      status,
      caller,
      workflow_id: agentId,
      failure_category: failure,
    });
    onClose();
  };

  const reset = () => {
    setStatus(undefined);
    setCaller(undefined);
    setAgentId(undefined);
    setFailure(undefined);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
        <Group title="Status">
          <ChipRow>
            <Chip label="Any" selected={!status} onPress={() => setStatus(undefined)} />
            {STATUSES.map((key) => (
              <Chip key={key} label={STATUS_FILTER_LABEL[key]} selected={status === key} onPress={() => setStatus(key)} />
            ))}
          </ChipRow>
        </Group>

        <Group title="Started by">
          <ChipRow>
            <Chip label="Anyone" selected={!caller} onPress={() => setCaller(undefined)} />
            {CALLERS.map((key) => (
              <Chip key={key} label={CALLER_LABEL[key]} selected={caller === key} onPress={() => setCaller(key)} />
            ))}
          </ChipRow>
        </Group>

        <Group title="Agent">
          <ChipRow>
            <Chip label="Any agent" selected={agentId == null} onPress={() => setAgentId(undefined)} />
            {visibleAgents.map((agent) => (
              <Chip
                key={agent.id}
                label={agent.name}
                selected={agentId === agent.id}
                onPress={() => setAgentId(agent.id)}
              />
            ))}
          </ChipRow>
        </Group>

        <Group title="Why it failed">
          <ChipRow>
            <Chip label="Any reason" selected={!failure} onPress={() => setFailure(undefined)} />
            {FAILURES.map((key) => (
              <Chip key={key} label={FAILURE_LABEL[key]} selected={failure === key} onPress={() => setFailure(key)} />
            ))}
          </ChipRow>
        </Group>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.half}>
          <Button title="Reset" variant="secondary" onPress={reset} />
        </View>
        <View style={styles.half}>
          <Button title="Apply" onPress={apply} />
        </View>
      </View>
    </View>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.caption, { color: colors.mutedText }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
});
