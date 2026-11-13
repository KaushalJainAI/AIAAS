/** Basics: name, one-line summary, tags and status. And the brief the agent is told. */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '../../../components/Text';
import { STATUS_COPY, AGENT_STATUSES } from '../config';
import { addTag } from '../edits';
import type { AgentConfig, AgentStatus } from '../types';
import { BuilderScreen, type Builder } from './BuilderScreen';
import { ChoiceList, Field, Note, Panel, TextBox } from '../ui';
import { pressedOpacity, spacing, typography, useTheme } from '../../../theme';
import { Icon } from '../../../components/Icon';

export function IdentityScreen({ id }: { id: string }) {
  return (
    <BuilderScreen id={id} title="Name and status" render={(b, cfg) => <IdentityForm b={b} cfg={cfg} />} />
  );
}

export function IdentityForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  const [tagDraft, setTagDraft] = useState('');
  const { colors } = useTheme();
  const commitTag = () => {
    const next = addTag(cfg.tags, tagDraft);
    if (next !== cfg.tags) b.set('tags', next);
    setTagDraft('');
  };
  return (
    <Panel>
      <Field label="Name" error={b.errors.name}>
        <TextBox
          accessibilityLabel="Name"
          value={cfg.name}
          onChangeText={(v) => b.set('name', v)}
          placeholder="Finance agent"
        />
      </Field>
      <Field label="One-line summary" hint="how other agents recognise it" error={b.errors.description}>
        <TextBox
          accessibilityLabel="One-line summary"
          value={cfg.description}
          onChangeText={(v) => b.set('description', v)}
          placeholder="Chases overdue invoices and reports what is stuck."
        />
      </Field>
      <Field label="Tags" hint="for grouping and search" error={b.errors.tags}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {cfg.tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
              onPress={() => b.set('tags', cfg.tags.filter((t) => t !== tag))}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.xs,
                minHeight: 32,
                paddingHorizontal: spacing.sm,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? pressedOpacity : 1,
              })}
            >
              <Text style={[typography.caption, { color: colors.text }]}>{tag}</Text>
              <Icon name="close" size={14} color={colors.mutedText} />
            </Pressable>
          ))}
        </View>
        <TextBox
          accessibilityLabel="Add a tag"
          value={tagDraft}
          onChangeText={setTagDraft}
          onSubmitEditing={commitTag}
          onBlur={commitTag}
          returnKeyType="done"
          placeholder={cfg.tags.length ? 'Add another…' : 'finance, weekly'}
        />
      </Field>
      <Field label="Status" error={b.errors.status}>
        <ChoiceList<AgentStatus>
          value={cfg.status}
          onChange={(v) => b.set('status', v)}
          options={AGENT_STATUSES.map((s) => ({ value: s, label: STATUS_COPY[s].label, hint: STATUS_COPY[s].hint }))}
        />
      </Field>
    </Panel>
  );
}

export function InstructionsScreen({ id }: { id: string }) {
  return (
    <BuilderScreen id={id} title="Instructions" render={(b, cfg) => <InstructionsForm b={b} cfg={cfg} />} />
  );
}

export function InstructionsForm({ b, cfg }: { b: Builder; cfg: AgentConfig }) {
  return (
    <Panel>
      <Field label="Brief" hint="What it is for, in one or two sentences" error={b.errors.brief}>
        <TextBox
          accessibilityLabel="Brief"
          multiline
          value={cfg.brief}
          onChangeText={(v) => b.set('brief', v)}
          placeholder="Reads invoices from Gmail and chases anything overdue…"
        />
      </Field>
      <Note>
        This is what the agent is told at the start of every run. The one-line summary is what other agents read
        when they choose which agent to hand a job to.
      </Note>
    </Panel>
  );
}
