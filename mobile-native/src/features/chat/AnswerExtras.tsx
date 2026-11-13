/**
 * What an answer carries besides its text: sources, images, file cards, charts,
 * HTML previews, worker plans, team solutions it read, the agent run it started,
 * and attachments the model could not take. The live turn and a saved message
 * draw the same blocks, so this takes plain props and never reads a stream.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Icon, type IconName } from '../../components/Icon';
import { Text } from '../../components/Text';
import { radius, spacing, typography, useTheme } from '../../theme';
import { ChartView } from './ChartView';
import { HtmlArtifactView } from './HtmlArtifactView';
import { PlanList } from './PlanList';
import type {
  AgentRunCardData,
  BlockedAttachment,
  ChartSpec,
  ChatImage,
  ChatSource,
  FileCard,
  HtmlArtifact,
  SolutionUsed,
  WorkerPlan,
} from './types';

/** A small grey heading over a block, as the web labels them. */
function BlockLabel({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.blockLabel}>
      <Icon name={icon} size={14} color={colors.mutedText} />
      <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

export function SourcesBlock({ sources }: { sources: ChatSource[] }) {
  const { colors, spacing: s } = useTheme();
  if (sources.length === 0) return null;
  return (
    <View style={{ gap: s.xs }}>
      <BlockLabel icon="link-outline" text={`${sources.length} source${sources.length === 1 ? '' : 's'}`} />
      {sources.map((source, i) => (
        <Pressable
          key={`${source.url}-${i}`}
          accessibilityRole="link"
          accessibilityLabel={source.title || source.url}
          onPress={() => void Linking.openURL(source.url).catch(() => undefined)}
          style={({ pressed }) => [
            styles.card,
            { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>
            {source.title || source.url}
          </Text>
          <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText }]}>
            {source.publisher || source.url}
          </Text>
          {source.snippet ? (
            <Text numberOfLines={2} style={[typography.caption, { color: colors.mutedText }]}>
              {source.snippet}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

export function ImagesBlock({ images }: { images: ChatImage[] }) {
  const { colors, spacing: s, radius: r } = useTheme();
  if (images.length === 0) return null;
  return (
    <View style={{ gap: s.xs }}>
      <BlockLabel icon="image-outline" text="Images" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: s.sm }}>
        {images.map((image, i) => (
          <Image
            key={`${image.url}-${i}`}
            source={{ uri: image.url }}
            accessibilityLabel={image.title || 'Image from the answer'}
            style={{ width: 140, height: 100, borderRadius: r.md, backgroundColor: colors.border }}
            resizeMode="cover"
          />
        ))}
      </View>
    </View>
  );
}

const FILE_ACTION: Record<FileCard['action'], string> = {
  created: 'Created',
  updated: 'Updated',
  appended: 'Appended to',
  edited: 'Edited',
};

/** Files the turn wrote. Opens the file in the web's file view, the one place that edits it. */
export function FilesBlock({ files }: { files: FileCard[] }) {
  const { colors, spacing: s } = useTheme();
  if (files.length === 0) return null;
  return (
    <View style={{ gap: s.xs }}>
      <BlockLabel icon="document-text-outline" text={`${files.length} file${files.length === 1 ? '' : 's'}`} />
      {files.map((file) => (
        <Pressable
          key={file.document_id}
          accessibilityRole="button"
          accessibilityLabel={`${FILE_ACTION[file.action]} ${file.name}. Open`}
          onPress={() => router.push({ pathname: '/web', params: { path: `/documents?doc=${file.document_id}`, title: file.name } })}
          style={({ pressed }) => [
            styles.fileRow,
            { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Icon name="document-outline" size={18} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[typography.label, { color: colors.text }]}>{file.name}</Text>
            <Text numberOfLines={1} style={[typography.caption, { color: colors.mutedText }]}>
              {`${FILE_ACTION[file.action]}${file.path ? ` · ${file.path}` : ''}`}
            </Text>
          </View>
          <Icon name="chevron-forward" size={16} color={colors.mutedText} />
        </Pressable>
      ))}
    </View>
  );
}

export function ChartsBlock({ charts }: { charts: ChartSpec[] }) {
  const { spacing: s } = useTheme();
  if (charts.length === 0) return null;
  return (
    <View style={{ gap: s.md }}>
      {charts.map((chart, i) => (
        <ChartView key={`${chart.title}-${i}`} chart={chart} />
      ))}
    </View>
  );
}

export function HtmlBlock({ artifacts }: { artifacts: HtmlArtifact[] }) {
  const { spacing: s } = useTheme();
  if (artifacts.length === 0) return null;
  return (
    <View style={{ gap: s.md }}>
      {artifacts.map((artifact, i) => (
        <HtmlArtifactView key={`${artifact.title}-${i}`} artifact={artifact} />
      ))}
    </View>
  );
}

export function WorkerPlansBlock({ plans }: { plans: WorkerPlan[] }) {
  const { colors, spacing: s } = useTheme();
  if (plans.length === 0) return null;
  return (
    <View style={{ gap: s.sm }}>
      {plans.map((plan) => (
        <View key={plan.execution_id} style={{ gap: s.xs }}>
          <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>{`${plan.agent_name} · plan`}</Text>
          <PlanList todos={plan.todos} />
        </View>
      ))}
    </View>
  );
}

/** A team solution the turn read: the person says whether it worked. */
export function SolutionsChip({
  solutions,
  onReview,
}: {
  solutions: SolutionUsed[];
  onReview: (id: number, kind: 'confirmed' | 'failed') => Promise<void>;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  const [recorded, setRecorded] = useState<Record<number, 'confirmed' | 'failed'>>({});
  if (solutions.length === 0) return null;
  const record = (id: number, kind: 'confirmed' | 'failed') => {
    setRecorded((prev) => ({ ...prev, [id]: kind }));
    // Optimistic: the verdict shows now. A failed write puts the row back to unanswered.
    onReview(id, kind).catch(() => {
      setRecorded((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  };
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md, gap: s.sm }]}>
      <View style={styles.solutionHead}>
        <Icon name="library-outline" size={16} color={colors.primary} />
        <Text style={[typography.label, { color: colors.text }]}>
          {`Checked ${solutions.length} team solution${solutions.length === 1 ? '' : 's'}`}
        </Text>
      </View>
      {solutions.map((item) => {
        const answered = recorded[item.id];
        return (
          <View key={item.id} style={{ gap: s.xs }}>
            <Text numberOfLines={2} style={[typography.caption, { color: colors.text }]}>
              {item.problem}
            </Text>
            {item.doubtful ? (
              <Text style={[typography.caption, { color: colors.warning }]}>Marked doubtful</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: s.sm }}>
              <VerdictButton label="Worked" selected={answered === 'confirmed'} disabled={answered !== undefined} onPress={() => record(item.id, 'confirmed')} />
              <VerdictButton label="Didn't work" selected={answered === 'failed'} disabled={answered !== undefined} onPress={() => record(item.id, 'failed')} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function VerdictButton({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const { colors, radius: r, spacing: s } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: s.md,
        borderRadius: r.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.surface : colors.background,
        opacity: disabled && !selected ? 0.5 : 1,
      }}
    >
      <Text style={[typography.label, { color: selected ? colors.primary : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

/** The agent this turn started, with a way into its run. */
export function AgentRunCard({ run }: { run: AgentRunCardData }) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: r.md, gap: s.sm }]}>
      <View style={styles.solutionHead}>
        <Icon name="hardware-chip-outline" size={16} color={colors.primary} />
        <Text style={[typography.label, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {run.agent_name}
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>{run.status}</Text>
      </View>
      <Button
        title="Open run"
        variant="secondary"
        onPress={() => router.push({ pathname: '/agents/run/[executionId]', params: { executionId: run.execution_id } })}
      />
    </View>
  );
}

/** Attachments the chosen model could not take. Stays until dismissed, because the fix is a model change. */
export function BlockedNotice({
  message,
  items,
  onDismiss,
}: {
  message: string;
  items: BlockedAttachment[];
  onDismiss: () => void;
}) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.card, { borderColor: colors.warning, backgroundColor: colors.warningBg, borderRadius: r.md, gap: s.xs }]}
    >
      <Text style={[typography.label, { color: colors.warning }]}>{message}</Text>
      {items.map((item, i) => (
        <Text key={`${item.id ?? i}`} style={[typography.caption, { color: colors.text }]}>
          {[item.name, item.reason].filter(Boolean).join(' — ')}
        </Text>
      ))}
      <View style={{ alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
          <Text style={[typography.label, { color: colors.primary }]}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The extras of one answer, in the web's order: sources, images, charts, previews, files, plans, solutions. */
export function AnswerExtras({
  sources = [],
  images = [],
  files = [],
  charts = [],
  htmlArtifacts = [],
  workerPlans = [],
  solutions = [],
  onReviewSolution,
}: {
  sources?: ChatSource[];
  images?: ChatImage[];
  files?: FileCard[];
  charts?: ChartSpec[];
  htmlArtifacts?: HtmlArtifact[];
  workerPlans?: WorkerPlan[];
  solutions?: SolutionUsed[];
  onReviewSolution?: (id: number, kind: 'confirmed' | 'failed') => Promise<void>;
}) {
  const { spacing: s } = useTheme();
  return (
    <View style={{ gap: s.md }}>
      <SourcesBlock sources={sources} />
      <ImagesBlock images={images} />
      <ChartsBlock charts={charts} />
      <HtmlBlock artifacts={htmlArtifacts} />
      <FilesBlock files={files} />
      <WorkerPlansBlock plans={workerPlans} />
      {onReviewSolution ? <SolutionsChip solutions={solutions} onReview={onReviewSolution} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  blockLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.xs },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, minHeight: 44 },
  solutionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
