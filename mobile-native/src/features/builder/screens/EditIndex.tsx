/**
 * The builder's front page: every screen of the agent's configuration on one list,
 * with a one-line summary each, and the actions that act on the whole agent.
 */
import { useEffect, useRef, useState } from 'react';
import { router, usePreventRemove } from 'expo-router';

import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { ListRow } from '../../../components/ListRow';
import { Section } from '../../../components/Section';
import { Text } from '../../../components/Text';
import { confirm } from '../../../components/confirm';
import { warning } from '../../../lib/haptics';
import { messageOf } from '../../agents/format';
import { FIELD_SECTION, STATUS_COPY, type AgentSection } from '../config';
import { SECTION_GROUPS, summaryFor } from '../sections';
import type { AgentConfig } from '../types';
import { spacing, typography, useTheme } from '../../../theme';
import { Notice } from '../ui';
import { useAgentSchedules } from '../queries';
import { BuilderScreen, type Builder } from './BuilderScreen';

export function EditIndexScreen({ id }: { id: string }) {
  return <BuilderScreen id={id} title="Edit agent" render={(b, cfg) => <EditIndex b={b} cfg={cfg} />} />;
}

function EditIndex({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const { colors } = useTheme();
  const [actionError, setActionError] = useState<string | null>(null);
  const schedules = useAgentSchedules(b.agentId);
  const scheduleCount = (schedules.data ?? []).filter((t) => t.mode === 'schedule').length;
  const modelName =
    b.activeProvider?.models?.find((m) => m.value === b.effectiveModel)?.name ?? (b.effectiveModel || null);

  // Leaving with unsaved edits asks first: back, the header, and the Android back button alike.
  // Deliberate navigation (after create, archive, delete) calls `release` first, so it does not ask again.
  // Read through a ref: the callback runs later, after `release` exists.
  const releaseRef = useRef<() => void>(() => undefined);
  const release = usePreventRemove(b.dirty, ({ repeat }) => {
    void confirm({
      title: 'Discard unsaved changes?',
      message: 'Your edits have not been saved. The agent keeps its last saved settings.',
      destructiveLabel: 'Discard',
    }).then((ok) => {
      if (ok) {
        releaseRef.current();
        repeat();
      }
    });
  });
  useEffect(() => {
    releaseRef.current = release;
  });

  const leaveTo = (path: string) => {
    release();
    router.replace(path as never);
  };

  const sectionHasError = (key: AgentSection) =>
    Object.keys(b.errors).some((field) => FIELD_SECTION[field as keyof AgentConfig] === key);

  const onCreate = async () => {
    const result = await b.save();
    if (result.ok) leaveTo(`/agents/${result.agent.id}`);
  };

  const onDuplicate = async () => {
    setActionError(null);
    try {
      const copy = await b.duplicate();
      leaveTo(`/agents/${copy.id}`);
    } catch (err) {
      setActionError(messageOf(err, 'Could not duplicate this agent.'));
    }
  };

  const onArchive = async () => {
    setActionError(null);
    try {
      await b.archive();
      leaveTo('/agents');
    } catch (err) {
      setActionError(messageOf(err, 'Could not archive this agent.'));
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete ${cfg.name || 'this agent'}?`,
      message: 'The agent, its schedules and its settings are removed for good. Its past runs stay on Runs, marked as deleted. To keep the agent, archive it instead.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    setActionError(null);
    try {
      await b.remove();
      leaveTo('/agents');
    } catch (err) {
      setActionError(messageOf(err, 'Could not delete this agent.'));
    }
  };

  const onDiscard = async () => {
    const ok = await confirm({
      title: 'Discard changes?',
      message: 'Every unsaved edit goes back to the last saved version.',
      destructiveLabel: 'Discard',
    });
    if (ok) b.discard();
  };

  const retired = b.saved?.model_status === 'retired';
  const isArchived = b.saved?.status === 'archived';

  return (
    <>
      {b.isNew ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Set it up below, then create it. Nothing exists until you create it.
        </Text>
      ) : null}
      {retired ? (
        <Notice tone="warning" text="This agent's model has been retired, so runs use the platform fallback until you pick another model and save." />
      ) : null}
      {actionError ? <Notice text={actionError} /> : null}

      {SECTION_GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.items.map((item) => (
            <ListRow
              key={item.key}
              icon={item.icon}
              title={item.title}
              subtitle={summaryFor(item.key, cfg, { modelName, scheduleCount })}
              detail={sectionHasError(item.key) ? <Badge label="Fix" tone="danger" /> : undefined}
              onPress={() => router.push(`/agents/${b.key}/edit/${item.key}` as never)}
            />
          ))}
        </Section>
      ))}

      {!b.isNew ? (
        <Section title="Manage" footer={`This agent is ${STATUS_COPY[cfg.status]?.label.toLowerCase() ?? cfg.status}.`}>
          <ListRow
            icon="time-outline"
            title="Change history"
            subtitle="Every saved version, and which runs used it"
            onPress={() => router.push(`/agents/${b.key}/history` as never)}
          />
          <ListRow
            icon="share-social-outline"
            title="Publish to Explore"
            subtitle="List it so others can install a copy"
            onPress={() => router.push(`/more/explore/publish/${b.key}` as never)}
          />
          <ListRow
            icon="copy-outline"
            title="Duplicate"
            subtitle="A draft copy, without its schedule"
            onPress={() => void onDuplicate()}
            disabled={b.duplicating}
          />
          <ListRow
            icon="archive-outline"
            title={isArchived ? 'Restore' : 'Archive'}
            subtitle={isArchived ? 'Show it in the list again' : 'Hide it and stop it running automatically'}
            onPress={() => void onArchive()}
            disabled={b.archiving}
          />
          <ListRow
            icon="trash-outline"
            title="Delete agent"
            subtitle="Its runs stay on record"
            destructive
            onPress={() => void onDelete()}
            disabled={b.removing}
          />
        </Section>
      ) : null}

      {b.dirty && !b.isNew ? (
        <Section>
          <ListRow icon="refresh-outline" title="Discard changes" destructive onPress={() => void onDiscard()} chevron={false} />
        </Section>
      ) : null}

      {b.isNew ? (
        <Button title="Create agent" onPress={() => void onCreate()} loading={b.saving} disabled={b.saving} />
      ) : null}
      <Text style={[typography.caption, { color: colors.mutedText, marginHorizontal: spacing.xs }]}>
        Schedules are made on the Schedules page. Runs use the saved version, so save before you run.
      </Text>
    </>
  );
}
