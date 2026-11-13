import { router, useCanGoBack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { EmptyState } from '../../../src/components/EmptyState';
import { Text } from '../../../src/components/Text';
import { ErrorText } from '../../../src/components/ErrorText';
import { Screen } from '../../../src/components/Screen';
import { QuestionForm } from '../../../src/features/inbox/QuestionForm';
import { actionFor, hitlOption, messageOf, requestTypeLabel } from '../../../src/features/inbox/request';
import { usePendingRequests, useRespond } from '../../../src/features/inbox/queries';
import { toQuestionSpec, type QuestionAnswer } from '../../../src/features/inbox/question';
import { timeAgo } from '../../../src/features/inbox/time';
import type { HITLResponseBody } from '../../../src/features/inbox/types';
import { success, warning } from '../../../src/lib/haptics';
import { useTheme } from '../../../src/theme';

/**
 * One request from the Inbox. The pending list is the only source (the web does
 * the same), so a request answered elsewhere shows as no longer waiting.
 */
export default function RequestScreen() {
  const raw = useLocalSearchParams<{ id: string }>().id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const { colors, spacing, fontSize, radius } = useTheme();
  const canGoBack = useCanGoBack();

  const pending = usePendingRequests(false);
  const respond = useRespond();
  const [error, setError] = useState<string | null>(null);

  const request = pending.data?.find((r) => r.request_id === id);

  const backToInbox = () => {
    if (canGoBack) router.back();
    else router.replace('/(tabs)/inbox');
  };

  const send = (body: HITLResponseBody) => {
    if (!request) return;
    setError(null);
    respond.mutate(
      { id: request.request_id, body },
      {
        onSuccess: () => {
          // Refusing or stopping is a warning; answering or approving went through.
          if (body.action === 'reject' || body.action === 'stop') warning();
          else success();
          backToInbox();
        },
        onError: (e) => setError(messageOf(e)),
      },
    );
  };

  if (!request) {
    if (pending.isPending) {
      return (
        <Screen>
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        </Screen>
      );
    }
    if (pending.isError) {
      return (
        <Screen>
          <View style={styles.center}>
            <ErrorText message={messageOf(pending.error)} />
            <View style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}>
              <Button title="Try again" variant="secondary" onPress={() => void pending.refetch()} />
            </View>
          </View>
        </Screen>
      );
    }
    return (
      <Screen>
        <EmptyState
          title="No longer waiting"
          message="This request was answered elsewhere, or it has expired."
        />
        <View style={{ marginTop: spacing.lg }}>
          <Button title="Back to Inbox" variant="secondary" onPress={() => router.replace('/(tabs)/inbox')} />
        </View>
      </Screen>
    );
  }

  const question = toQuestionSpec(request.question);
  const hasOptions = (request.options?.length ?? 0) > 0;
  const actions = hasOptions
    ? request.options.map(hitlOption)
    : [
        { label: 'Approve', value: 'approve' },
        { label: 'Reject', value: 'reject' },
      ];
  const busy = respond.isPending;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
            {requestTypeLabel(request.request_type)} · {timeAgo(request.created_at)}
          </Text>
          <Text style={{ color: colors.text, fontSize: fontSize.title, fontWeight: '700' }}>{request.title}</Text>
          {request.workflow_name ? (
            <Text style={{ color: colors.mutedText, fontSize: fontSize.md }}>Agent: {request.workflow_name}</Text>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
          ]}
        >
          {request.detail ? (
            <>
              <Text selectable style={{ color: colors.text, fontSize: fontSize.md, lineHeight: 22 }}>
                {request.detail.sentence || request.detail.title}
              </Text>
              {request.detail.fields.map((field, i) => (
                <View key={`${field.label}-${i}`} style={{ gap: 2 }}>
                  <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>{field.label}</Text>
                  <Text selectable style={{ color: colors.text, fontSize: fontSize.md }}>
                    {field.value}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text selectable style={{ color: colors.text, fontSize: fontSize.md, lineHeight: 22 }}>
              {request.message}
            </Text>
          )}
        </View>

        <ErrorText message={error} />

        {question ? (
          <QuestionForm
            key={request.request_id}
            spec={question}
            busy={busy}
            onSubmit={(answer: QuestionAnswer) => send({ action: 'respond', response: answer })}
            onSkip={() => send({ action: 'skip' })}
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {actions.map((option, i) => (
              <Button
                key={`${option.value}-${option.label}`}
                title={option.label}
                variant={i === 0 ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => send({ action: actionFor(option.value), response: option.label })}
              />
            ))}
            {hasOptions ? (
              <Button title="Stop this run" variant="secondary" disabled={busy} onPress={() => send({ action: 'reject' })} />
            ) : null}
          </View>
        )}

        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
          Nothing has left your account. This step runs only after you answer.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth },
});
