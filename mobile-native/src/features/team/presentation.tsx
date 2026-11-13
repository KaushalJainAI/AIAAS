import { StyleSheet, View } from 'react-native';

import { Badge, type Tone } from '../../components/Badge';
import { Text } from '../../components/Text';
import { spacing, typography, useTheme } from '../../theme';
import { claimKindInfo } from './form';
import type { Solution } from './types';

/**
 * The status badges a solution wears, in the web's order: draft or queue first,
 * then doubt and freshness, then whether it is shared.
 */
export function Badges({ s }: { s: Solution }) {
  const items: { label: string; tone: Tone }[] = [];
  if (s.status === 'draft') items.push({ label: 'Draft: only you can see it', tone: 'primary' });
  if (s.status === 'pending_review') items.push({ label: 'Waiting for a curator', tone: 'warning' });
  if (s.doubtful) items.push({ label: 'Doubtful', tone: 'warning' });
  if (s.status === 'needs_check') items.push({ label: 'Needs check', tone: 'warning' });
  if (s.status === 'superseded') items.push({ label: 'Replaced', tone: 'neutral' });
  if (s.checks_needed.length > 0) {
    const n = s.checks_needed.length;
    items.push({ label: `${n} claim${n === 1 ? '' : 's'} may be out of date`, tone: 'neutral' });
  }
  if (s.status !== 'draft' && s.status !== 'pending_review') {
    items.push({ label: s.shared_with_org ? 'Shared' : 'Private', tone: 'neutral' });
  }
  return (
    <View style={styles.badges}>
      {items.map((item) => (
        <Badge key={item.label} label={item.label} tone={item.tone} />
      ))}
    </View>
  );
}

/** The fix as it reads: what it solves, why, what to do, and what could change. */
export function SolutionText({ s }: { s: Solution }) {
  const { colors } = useTheme();
  const claims = s.claims;
  const env = Object.entries(s.environment ?? {});
  return (
    <View style={styles.stack}>
      <View style={styles.stack}>
        <Text style={[typography.heading, { color: colors.text }]}>{s.problem}</Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Solved by {s.solved_by}
          {s.solved_on ? ` on ${s.solved_on}` : ''} · last known true {s.last_known_true} · worked for{' '}
          {s.track_record.worked}, failed for {s.track_record.failed}
        </Text>
        <Badges s={s} />
      </View>

      {s.doubtful ? (
        <View style={[styles.callout, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
          <Text style={[typography.body, { color: colors.text }]}>
            <Text style={[typography.label, { color: colors.text }]}>Flagged as possibly wrong: </Text>
            {s.doubtful}
          </Text>
        </View>
      ) : null}

      {s.symptoms ? (
        <Section label="Symptoms">
          <Text style={[typography.mono, { color: colors.text }]}>{s.symptoms}</Text>
        </Section>
      ) : null}
      {s.root_cause ? (
        <Section label="Cause">
          <Text style={[typography.body, { color: colors.text }]}>{s.root_cause}</Text>
        </Section>
      ) : null}
      <Section label="Fix">
        <Text style={[typography.body, { color: colors.text }]}>{s.resolution}</Text>
      </Section>

      {claims.length > 0 ? (
        <Section label="What could change">
          {claims.map((c, i) => (
            <View key={i} style={styles.claim}>
              <Badge label={c.state === 'check' ? 'Check' : 'Current'} tone={c.state === 'check' ? 'warning' : 'success'} />
              <Text style={[typography.caption, { color: colors.mutedText }]}>{claimKindInfo(c.kind).label}</Text>
              <Text style={[typography.body, { color: colors.text }]}>{c.text}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      {env.length > 0 ? (
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          Applied to: {env.map(([k, v]) => `${k} ${v}`).join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <Text style={[typography.caption, styles.label, { color: colors.mutedText }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  callout: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: spacing.md },
  label: { fontWeight: '600' },
  claim: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
});
