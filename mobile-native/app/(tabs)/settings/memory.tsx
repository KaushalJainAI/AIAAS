import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { confirm } from '../../../src/components/confirm';
import { Text } from '../../../src/components/Text';

import { ApiError } from '../../../src/api/client';
import { Button } from '../../../src/components/Button';
import { ErrorText } from '../../../src/components/ErrorText';
import { Screen } from '../../../src/components/Screen';
import { groupMemories, isHidden } from '../../../src/features/settings/format';
import { useForgetAllMemory, useForgetMemory, useMemory } from '../../../src/features/settings/queries';
import type { UserMemory } from '../../../src/features/settings/types';
import { useTheme } from '../../../src/theme';

/**
 * What the assistant has stored about you. Every fact rides in the prompt of
 * every future turn, so a wrong one stays wrong until it is removed here.
 * There is no add: a typed fact is a preference and belongs on the profile.
 */
export default function MemoryScreen() {
  const { colors, spacing, fontSize, radius } = useTheme();
  const memory = useMemory();
  const forget = useForgetMemory();
  const forgetAll = useForgetAllMemory();

  const memories = memory.data?.memories ?? [];
  const groups = groupMemories(memories);
  const hiddenCount = memories.filter(isHidden).length;
  const max = memory.data?.max_per_category;

  async function confirmForget(item: UserMemory) {
    if (await confirm({ title: 'Forget this?', message: item.text, destructiveLabel: 'Forget' })) {
      forget.mutate(item.id);
    }
  }

  async function confirmForgetAll() {
    const first = await confirm({
      title: 'Forget everything?',
      message: `All ${memories.length} facts the assistant has stored about you will be removed. It will learn them again only if you tell it again.`,
      destructiveLabel: 'Continue',
    });
    if (!first) return;
    const sure = await confirm({
      title: 'This cannot be undone',
      message: 'Forget every stored fact now?',
      destructiveLabel: 'Forget everything',
      cancelLabel: 'Keep them',
    });
    if (sure) forgetAll.mutate();
  }

  const actionFailure = forget.error ?? forgetAll.error;
  const actionMessage = actionFailure
    ? actionFailure instanceof ApiError
      ? actionFailure.message
      : 'Could not forget that. Check your connection and try again.'
    : null;

  if (memory.isPending) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        {memory.isError ? (
          <ErrorText message="Could not load memories. Check your connection and reopen this screen." />
        ) : memories.length === 0 ? (
          <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl }}>
            <Text style={{ color: colors.text, fontSize: fontSize.lg, fontWeight: '600' }}>Nothing remembered yet</Text>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.md, textAlign: 'center' }}>
              Things you tell the assistant about yourself, such as how you work or what you are building, appear here.
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.md }}>
              The assistant and your agents read this on every turn. Remove anything wrong, or anything you would rather it did not keep.
            </Text>

            {hiddenCount > 0 ? (
              <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, fontStyle: 'italic' }}>
                {hiddenCount === 1 ? '1 fact is' : `${hiddenCount} facts are`} stored but not shown to the assistant, because the memory space is full.
              </Text>
            ) : null}

            {groups.map((group) => (
              <View key={group.category} style={{ gap: spacing.sm }}>
                <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, fontWeight: '600', textTransform: 'uppercase' }}>
                  {group.label} · {group.items.length}
                  {max ? ` of ${max}` : ''}
                </Text>
                <View
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: radius.md,
                    overflow: 'hidden',
                  }}
                >
                  {group.items.map((item, index) => {
                    const hidden = isHidden(item);
                    const busy = forget.isPending && forget.variables === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onLongPress={() => confirmForget(item)}
                        accessibilityHint="Long press to forget this fact"
                        style={[
                          styles.item,
                          {
                            padding: spacing.lg,
                            gap: spacing.md,
                            borderTopColor: colors.border,
                            borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                          },
                        ]}
                      >
                        <View style={{ flex: 1, gap: spacing.xs }}>
                          <Text style={{ color: hidden ? colors.mutedText : colors.text, fontSize: fontSize.md, lineHeight: 22 }}>
                            {item.text}
                          </Text>
                          {hidden ? (
                            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, fontStyle: 'italic' }}>
                              Not shown to the assistant, because memory is full
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Forget ${item.text}`}
                          disabled={busy}
                          onPress={() => confirmForget(item)}
                          hitSlop={8}
                          style={({ pressed }) => ({ opacity: busy ? 0.5 : pressed ? 0.6 : 1 })}
                        >
                          <Text style={{ color: colors.danger, fontSize: fontSize.sm, fontWeight: '600' }}>
                            {busy ? 'Forgetting…' : 'Forget'}
                          </Text>
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            <Button
              title="Forget everything"
              variant="secondary"
              onPress={confirmForgetAll}
              loading={forgetAll.isPending}
              disabled={forget.isPending}
            />
          </>
        )}
        <ErrorText message={actionMessage} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'flex-start' },
});
