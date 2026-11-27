/**
 * "Undo what this run changed": the files, folders, memory and agent settings a
 * chat answer or a run changed, with a checkbox per change that can be put back
 * from here. Mirrors the web's `components/changes/ChangesSheet.tsx`: the same
 * wording, groups, checkboxes, live and incomplete notes, outcomes and summary.
 * It is a pushed screen on the phone, not a sheet, so the back button leaves it.
 */
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { useRefresh } from '../../hooks/useRefresh';
import { success, tap, warning } from '../../lib/haptics';
import { pressedOpacity, radius, spacing, typography, useTheme } from '../../theme';
import type { ChangeRow } from './api';
import {
  anyIncomplete,
  collect,
  defaultTicked,
  groupByWorker,
  outcomeFor,
  rootName,
  summariseRevert,
  type OutcomeLine,
} from './format';
import { useChangeSet } from './queries';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The undo screen for one change set (`/chat/changes/<id>`). */
export function ChangesScreen({ setId }: { setId: number }) {
  const { colors } = useTheme();
  const { query, revert, result } = useChangeSet(setId);
  const { refreshing, onRefresh } = useRefresh(query.refetch);
  /** Only the person's own ticks: everything else follows the defaults. */
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});

  if (!Number.isInteger(setId) || setId <= 0) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorState title="Not found" message="This change set was not found." />
      </Screen>
    );
  }
  if (query.isPending) {
    return (
      <Screen edges={['left', 'right']}>
        <LoadingState text="Loading the changes…" />
      </Screen>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorState
          message={messageOf(query.error, 'Could not load these changes.')}
          onRetry={() => void query.refetch()}
        />
      </Screen>
    );
  }

  const detail = query.data;
  const entries = collect(detail.set, rootName(detail.set));
  const ticked = (row: ChangeRow) => (row.id in overrides ? overrides[row.id] : defaultTicked(row));
  const pickedIds = entries
    .filter(({ row }) => row.revertible && row.outcome !== 'reverted' && ticked(row))
    .map(({ row }) => row.id);
  const revertible = entries.filter(({ row }) => row.revertible);
  const blocked = entries.filter(({ row }) => !row.revertible);
  const incomplete = anyIncomplete(detail.set);
  const live = detail.live;
  const reverting = revert.isPending;

  const toggle = (row: ChangeRow) => {
    tap();
    setOverrides((prev) => ({ ...prev, [row.id]: !ticked(row) }));
  };

  const undo = async () => {
    try {
      const outcome = await revert.mutateAsync(pickedIds);
      if (outcome.skipped === 0 && outcome.failed === 0) success();
      else warning();
    } catch {
      // The refusal is shown under the button (revert.error); it only needs the haptic.
      warning();
    }
  };

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            Undo what this run changed
          </Text>
          <Text style={[typography.body, { color: colors.mutedText }]}>
            Files go back to how they were before. Anything you changed since is left alone.
          </Text>
        </View>

        {live ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.notice, { backgroundColor: colors.warningBg, borderColor: colors.warning, borderRadius: radius.md }]}
          >
            <Text style={[typography.body, { color: colors.text }]}>
              {`${detail.live_reason ?? 'A run is still changing things.'} Undo is available once it finishes.`}
            </Text>
          </View>
        ) : null}
        {incomplete ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            Some changes may be missing from this list.
          </Text>
        ) : null}
        {detail.truncated ? (
          <Text style={[typography.caption, { color: colors.mutedText }]}>
            {`Only some of the ${detail.total} changes are listed.`}
          </Text>
        ) : null}
        {detail.total === 0 ? (
          <Text style={[typography.body, { color: colors.mutedText }]}>
            Nothing was changed, so there is nothing to undo.
          </Text>
        ) : null}

        {revertible.length > 0 ? (
          <View style={styles.block}>
            <Heading text="Can be undone" />
            {groupByWorker(revertible).map((group) => (
              <Section key={group.worker} title={group.worker}>
                {group.items.map(({ row }) => (
                  <ChangeLine
                    key={row.id}
                    row={row}
                    ticked={ticked(row)}
                    outcome={outcomeFor(row, result)}
                    disabled={reverting}
                    onToggle={() => toggle(row)}
                  />
                ))}
              </Section>
            ))}
          </View>
        ) : null}

        {blocked.length > 0 ? (
          <View style={styles.block}>
            <Heading text="Can't be undone from here" />
            {groupByWorker(blocked).map((group) => (
              <Section key={group.worker} title={group.worker}>
                {group.items.map(({ row }) => (
                  <BlockedLine key={row.id} row={row} />
                ))}
              </Section>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {detail.total > 0 ? (
        <View style={styles.footer}>
          {result ? (
            <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.mutedText }]}>
              {summariseRevert(result)}
            </Text>
          ) : null}
          {revert.isError ? (
            <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger }]}>
              {messageOf(revert.error, 'This cannot be undone right now.')}
            </Text>
          ) : null}
          <Button
            title={pickedIds.length === 1 ? 'Undo 1 change' : `Undo ${pickedIds.length} changes`}
            disabled={live || pickedIds.length === 0}
            loading={reverting}
            onPress={() => void undo()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/** A group heading over the rows, as the web's section titles are drawn. */
function Heading({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Text accessibilityRole="header" style={[typography.caption, styles.heading, { color: colors.mutedText }]}>
      {text.toUpperCase()}
    </Text>
  );
}

const TONE_KEY: Record<OutcomeLine['tone'], 'success' | 'mutedText' | 'danger'> = {
  success: 'success',
  muted: 'mutedText',
  danger: 'danger',
};

/** One change that can be put back: a checkbox, or "Undone" with no checkbox. */
function ChangeLine({
  row,
  ticked,
  outcome,
  disabled,
  onToggle,
}: {
  row: ChangeRow;
  ticked: boolean;
  outcome: OutcomeLine | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();

  // Already put back: nothing left to choose, so no checkbox.
  if (row.outcome === 'reverted') {
    return (
      <View style={styles.line}>
        <Icon name="checkmark-circle" size={22} color={colors.success} />
        <View style={styles.lineText}>
          <Text style={[typography.body, { color: colors.text }]}>{row.label}</Text>
          <Text style={[typography.caption, { color: colors.success }]}>Undone</Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={row.label}
      accessibilityState={{ checked: ticked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.line, pressed && { opacity: pressedOpacity }]}
    >
      <Icon
        name={ticked ? 'checkbox' : 'square-outline'}
        size={22}
        color={ticked ? colors.primary : colors.mutedText}
      />
      <View style={styles.lineText}>
        <Text style={[typography.body, { color: colors.text }]}>{row.label}</Text>
        {outcome ? (
          <Text style={[typography.caption, { color: colors[TONE_KEY[outcome.tone]] }]}>{outcome.text}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A change that cannot be put back from here: no checkbox, the reason under it. */
function BlockedLine({ row }: { row: ChangeRow }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Icon name="remove-circle-outline" size={22} color={colors.mutedText} />
      <View style={styles.lineText}>
        <Text style={[typography.body, { color: colors.text }]}>{row.label}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          {row.reason || 'This cannot be undone from here.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.lg },
  intro: { gap: spacing.xs },
  notice: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  block: { gap: spacing.sm },
  heading: { paddingHorizontal: spacing.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  lineText: { flex: 1, minWidth: 0, gap: spacing.xs },
  footer: { gap: spacing.sm, paddingTop: spacing.md },
});
