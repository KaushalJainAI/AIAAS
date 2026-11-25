/**
 * The browser calls one answer made: the latest picture, the page it is on, a
 * way to watch it live, the calls newest first with their steps, and a notice when
 * the site needs the person. The web's browser pane is the same data in a side panel.
 *
 * The calls come from `browserViews.ts` (passed by key, not in the route). A picture
 * is fetched with the bearer token; a 404 means it has expired.
 */
import { Stack, router, useCanGoBack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '../../api/client';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { tap } from '../../lib/haptics';
import { radius, spacing, typography, useTheme } from '../../theme';
import { authorizationHeaders, fetchFile } from '../files/transfer';
import {
  awaitingUser,
  browserFramePath,
  browserFrameUrl,
  doneMessage,
  hostOf,
  recallBrowserViews,
} from './browserViews';
import { queueHandOff } from './handOff';
import type { BrowserStep, BrowserView } from './types';

function stepText(step: BrowserStep): string {
  return [step.action, step.selector].filter(Boolean).join(' ');
}

type PictureState = 'shown' | 'expired' | 'failed';

/**
 * A kept picture, drawn with the bearer token. The image does not say why it failed,
 * so a failure asks the server: 404 means the picture has expired, anything else
 * offers a retry.
 */
function FramePicture({ frameId }: { frameId: string }) {
  const { colors } = useTheme();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PictureState>('shown');

  if (state === 'expired') {
    return (
      <View style={styles.pictureBox}>
        <EmptyState title="This picture has expired." />
      </View>
    );
  }
  if (state === 'failed') {
    return (
      <View style={styles.pictureBox}>
        <ErrorState
          message="This picture could not be loaded."
          onRetry={() => {
            setState('shown');
            setAttempt((n) => n + 1);
          }}
        />
      </View>
    );
  }
  return (
    <Image
      key={attempt}
      accessibilityLabel="Latest browser picture"
      source={{ uri: browserFrameUrl(frameId), headers: authorizationHeaders() }}
      resizeMode="contain"
      onError={() => {
        fetchFile(browserFramePath(frameId)).then(
          () => setState('failed'),
          (err: unknown) => setState(err instanceof ApiError && err.status === 404 ? 'expired' : 'failed'),
        );
      }}
      style={[styles.picture, { backgroundColor: colors.surfaceMuted }]}
    />
  );
}

/**
 * The site needs the person. "I'm done" hands the chat the same words the web
 * sends. Without `onDone` (no chat to return to) the person is told to go back
 * and say it themselves.
 */
function NeedsUser({ host, text, onDone }: { host: string; text: string; onDone?: () => void }) {
  const { colors, spacing: s, radius: r } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderColor: colors.warning, backgroundColor: colors.warningBg, borderRadius: r.md, gap: s.xs }]}
    >
      <Text style={[typography.label, { color: colors.warning }]}>
        {`The assistant needs you on ${host || 'this site'}: ${text}`}
      </Text>
      {onDone ? (
        <>
          <Text style={[typography.caption, { color: colors.text }]}>{"Finish it, then tap I'm done."}</Text>
          <Button title="I'm done" onPress={onDone} />
        </>
      ) : (
        <Text style={[typography.caption, { color: colors.text }]}>
          Finish it, then go back to the chat and tell the assistant you are done.
        </Text>
      )}
    </View>
  );
}

/** One call: its title and address, then each step with a tick or a cross. */
function CallCard({ view, number }: { view: BrowserView; number: number }) {
  const { colors, spacing: s } = useTheme();
  const host = hostOf(view.url);
  return (
    <Card>
      <View style={{ gap: s.xs }}>
        <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>{`Call ${number}`}</Text>
        <Text numberOfLines={2} style={[typography.label, { color: colors.text }]}>
          {view.title || host || view.url || 'Browser call'}
        </Text>
        {view.url ? (
          <Text numberOfLines={2} selectable style={[typography.caption, { color: colors.mutedText }]}>
            {view.url}
          </Text>
        ) : null}
      </View>
      {view.steps.length === 0 ? (
        <Text style={[typography.caption, { color: colors.mutedText, marginTop: s.md }]}>No steps</Text>
      ) : (
        <View style={{ gap: s.xs, marginTop: s.md }}>
          {view.steps.map((step, i) => {
            const text = stepText(step);
            return (
              <View
                key={i}
                accessible
                accessibilityLabel={`${step.ok ? 'Done' : 'Failed'}: ${text}`}
                style={styles.step}
              >
                <Icon
                  name={step.ok ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={step.ok ? colors.success : colors.danger}
                />
                <Text numberOfLines={2} style={[typography.body, { color: colors.text, flex: 1 }]}>
                  {text || 'Step'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

/** The Browser screen for one answer. `viewsKey` comes from the chip that opened it. */
export function BrowserScreen({ viewsKey }: { viewsKey: string }) {
  const { colors, spacing: s } = useTheme();
  const views = useMemo(() => recallBrowserViews(viewsKey), [viewsKey]);
  // "I'm done" needs a conversation to go back to; the Browser screen is only ever pushed from one.
  const canReturn = useCanGoBack();

  if (!views || views.length === 0) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <Stack.Screen options={{ title: 'Browser' }} />
        <EmptyState title="This browser view is no longer open" message="Open the answer again to see the browser's calls." />
      </Screen>
    );
  }

  const newest = views[views.length - 1];
  const host = hostOf(newest.url);
  const picture = [...views].reverse().find((v) => v.frame_id);
  const live = [...views].reverse().find((v) => v.live_url);
  // The call that is waiting for the person, not necessarily the newest one (the web's rule).
  const waiting = awaitingUser(views);
  const waitingHost = waiting ? hostOf(waiting.url) : '';

  const sayDone = () => {
    tap();
    queueHandOff(doneMessage(waitingHost || 'page'));
    router.back();
  };

  return (
    <Screen edges={['left', 'right', 'bottom']} style={{ padding: 0 }}>
      <Stack.Screen options={{ title: host ? `Browser · ${host}` : 'Browser' }} />
      <ScrollView contentContainerStyle={{ padding: s.lg, gap: s.lg }}>
        {waiting?.needs_user ? (
          <NeedsUser
            host={waitingHost}
            text={waiting.needs_user}
            onDone={canReturn ? sayDone : undefined}
          />
        ) : null}

        <View style={{ gap: s.xs }}>
          <Text accessibilityRole="header" style={[typography.heading, { color: colors.text }]}>
            {newest.title || host || 'Browser'}
          </Text>
          {newest.url ? (
            <Text selectable numberOfLines={2} style={[typography.mono, { color: colors.mutedText }]}>
              {newest.url}
            </Text>
          ) : null}
        </View>

        {live ? (
          <Button
            title="Watch live"
            variant="secondary"
            onPress={() => void Linking.openURL(live.live_url).catch(() => undefined)}
          />
        ) : null}

        <View style={{ gap: s.sm }}>
          <Text accessibilityRole="header" style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>
            Latest picture
          </Text>
          {picture ? (
            <FramePicture frameId={picture.frame_id} />
          ) : (
            <Text style={[typography.body, { color: colors.mutedText }]}>No picture was kept.</Text>
          )}
        </View>

        <View style={{ gap: s.sm }}>
          <Text accessibilityRole="header" style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>
            {`Calls (${views.length})`}
          </Text>
          {[...views].reverse().map((view, i) => {
            const number = views.length - i;
            return <CallCard key={number} view={view} number={number} />;
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pictureBox: { height: 200 },
  picture: { width: '100%', height: 260, borderRadius: radius.md },
  notice: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
});
