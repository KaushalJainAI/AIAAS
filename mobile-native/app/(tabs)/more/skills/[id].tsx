import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '../../../../src/components/Button';
import { Card } from '../../../../src/components/Card';
import { ErrorState } from '../../../../src/components/ErrorState';
import { ErrorText } from '../../../../src/components/ErrorText';
import { Icon } from '../../../../src/components/Icon';
import { LoadingState } from '../../../../src/components/LoadingState';
import { Markdown } from '../../../../src/components/Markdown';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { TextField } from '../../../../src/components/TextField';
import { Text } from '../../../../src/components/Text';
import { confirm } from '../../../../src/components/confirm';
import { messageOf } from '../../../../src/features/agents/format';
import { ChoicePicker } from '../../../../src/features/explore/ChoicePicker';
import { CATEGORIES, SKILL_EDITOR_PLACEHOLDER } from '../../../../src/features/skills/copy';
import {
  useCreateSkill,
  useForkSkill,
  useRemoveSkill,
  useSkills,
  useToggleSkillShare,
  useUpdateSkill,
} from '../../../../src/features/skills/queries';
import type { Skill, SkillTab } from '../../../../src/features/skills/types';
import { success, warning } from '../../../../src/lib/haptics';
import { fontFamily, fontSize, radius, spacing, typography, useTheme } from '../../../../src/theme';

type Mode = 'write' | 'preview';

/**
 * One skill: create, edit, share, fork and delete. A library skill belongs to someone
 * else, so it opens to read and is copied ("Add to mine") to edit. The id `new` creates.
 */
export default function SkillEditorScreen() {
  const { id = 'new', tab: rawTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const { colors, spacing: s } = useTheme();
  const isNew = id === 'new';
  const tab: SkillTab = rawTab === 'public' ? 'public' : 'mine';
  const skills = useSkills();

  if (!isNew && skills.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Skill' }} />
        <LoadingState text="Loading skill" />
      </Screen>
    );
  }

  const skill = isNew ? undefined : (skills.data ?? []).find((x) => String(x.id) === id);
  if (!isNew && !skill) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Skill' }} />
        <ErrorState
          title="Skill not found"
          message={skills.isError ? messageOf(skills.error, 'Could not load this skill.') : 'It may have been deleted.'}
          onRetry={() => void skills.refetch()}
        />
      </Screen>
    );
  }

  return (
    <SkillForm
      key={skill ? skill.id : 'new'}
      skill={skill}
      readOnly={!isNew && tab === 'public'}
      onLeave={() => router.replace('/more/skills')}
      colors={colors}
      spacing={s}
    />
  );
}

function SkillForm({
  skill,
  readOnly,
  onLeave,
  colors,
  spacing: s,
}: {
  skill: Skill | undefined;
  readOnly: boolean;
  onLeave: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  spacing: typeof spacing;
}) {
  const [title, setTitle] = useState(skill?.title ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [category, setCategory] = useState(skill?.category ?? 'General');
  const [content, setContent] = useState(skill?.content ?? '');
  const [mode, setMode] = useState<Mode>('write');
  const [pickingCategory, setPickingCategory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSkill();
  const update = useUpdateSkill();
  const remove = useRemoveSkill();
  const share = useToggleSkillShare();
  const fork = useForkSkill();
  const busy = create.isPending || update.isPending || remove.isPending || share.isPending || fork.isPending;

  const categoryLabel = CATEGORIES.find((c) => c.value === category)?.label ?? category;
  const canSave = title.trim().length > 0 && !busy;

  const save = () => {
    if (!title.trim()) {
      setError('Give the skill a title first.');
      return;
    }
    setError(null);
    setNotice(null);
    const input = { title: title.trim(), description, content, category };
    const done = () => {
      success();
      if (!skill) onLeave();
      else setNotice('Skill saved.');
    };
    const fail = (err: unknown) => setError(messageOf(err, 'Could not save the skill.'));
    if (skill) update.mutate({ id: skill.id, input }, { onSuccess: done, onError: fail });
    else create.mutate(input, { onSuccess: done, onError: fail });
  };

  const toggleShare = () => {
    if (!skill) return;
    setError(null);
    share.mutate(skill.id, {
      onSuccess: (message) => setNotice(message || (skill.isShared ? 'No longer shared.' : 'Shared with everyone.')),
      onError: (err) => setError(messageOf(err, 'Could not change sharing.')),
    });
  };

  const deleteSkill = async () => {
    if (!skill) return;
    const ok = await confirm({
      title: 'Delete skill?',
      message: 'This removes the skill from your collection. This cannot be undone.',
      destructiveLabel: 'Delete',
    });
    if (!ok) return;
    warning();
    remove.mutate(skill.id, {
      onSuccess: onLeave,
      onError: (err) => setError(messageOf(err, 'Could not delete the skill.')),
    });
  };

  const addToMine = () => {
    if (!skill) return;
    setError(null);
    fork.mutate(skill.id, {
      onSuccess: () => {
        success();
        onLeave();
      },
      onError: (err) => setError(messageOf(err, 'Could not add the skill.')),
    });
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ title: skill ? skill.title || 'Skill' : 'New skill' }} />
      <ScrollView contentContainerStyle={{ gap: s.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {readOnly ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            By {skill?.author}. A shared skill reads here; add it to your skills to edit it.
          </Text>
        ) : null}

        <TextField
          label="Title"
          value={title}
          onChangeText={setTitle}
          editable={!readOnly}
          placeholder="Skill title"
        />
        <TextField
          label="Short description"
          value={description}
          onChangeText={setDescription}
          editable={!readOnly}
          placeholder="One line on what it is for"
        />

        <View style={{ gap: s.xs }}>
          <Text style={[typography.label, { color: colors.text }]}>Category</Text>
          {readOnly ? (
            <Text style={[typography.body, { color: colors.text }]}>{categoryLabel}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Category: ${categoryLabel}. Change`}
              onPress={() => setPickingCategory(true)}
              style={({ pressed }) => [
                styles.picker,
                { borderColor: colors.border, backgroundColor: colors.inputBackground, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[typography.body, styles.pickerText, { color: colors.text }]}>{categoryLabel}</Text>
              <Icon name="chevron-down" size={18} color={colors.mutedText} />
            </Pressable>
          )}
        </View>

        <SegmentedControl
          items={[
            { key: 'write', label: 'Write', count: 0 },
            { key: 'preview', label: 'Preview', count: 0 },
          ]}
          value={mode}
          onChange={setMode}
        />

        {mode === 'write' && !readOnly ? (
          <TextField
            label="Instructions (Markdown)"
            value={content}
            onChangeText={setContent}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={SKILL_EDITOR_PLACEHOLDER}
            style={styles.editor}
          />
        ) : (
          <Card>
            {content.trim() ? (
              <Markdown text={content} />
            ) : (
              <Text style={[typography.body, { color: colors.mutedText }]}>Nothing written yet.</Text>
            )}
          </Card>
        )}

        {notice ? (
          <Text accessibilityRole="alert" style={[typography.body, { color: colors.success }]}>
            {notice}
          </Text>
        ) : null}
        <ErrorText message={error} />

        {readOnly ? (
          <Button title="Add to mine" onPress={addToMine} loading={fork.isPending} />
        ) : (
          <>
            <Button title={skill ? 'Save' : 'Create skill'} onPress={save} disabled={!canSave} loading={create.isPending || update.isPending} />
            {skill ? (
              <>
                <Button
                  title={skill.isShared ? 'Stop sharing' : 'Share with everyone'}
                  variant="secondary"
                  onPress={toggleShare}
                  loading={share.isPending}
                />
                <Button title="Delete skill" variant="secondary" onPress={() => void deleteSkill()} loading={remove.isPending} />
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <ChoicePicker<string>
        visible={pickingCategory}
        title="Category"
        value={category}
        options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        onSelect={setCategory}
        onClose={() => setPickingCategory(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  pickerText: { flex: 1, fontSize: fontSize.md },
  editor: { minHeight: 260, textAlignVertical: 'top', fontFamily: fontFamily.regular },
});
