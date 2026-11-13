/**
 * Actions on one message, opened by a long press: copy, regenerate (an answer),
 * edit and take back (a message the person wrote), a thumbs rating with a reason
 * for a bad one, and delete. Delete asks first. Labels follow the web's message
 * actions; read-aloud is not offered (it needs an audio player the app does not have).
 */
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { View } from 'react-native';

import type { IconName } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { Sheet } from '../../components/Sheet';
import { confirm } from '../../components/confirm';
import { useTheme } from '../../theme';
import type { ChatMessage } from './types';

export const FEEDBACK_REASONS: { value: string; label: string }[] = [
  { value: 'wrong', label: 'Wrong' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'slow', label: 'Slow' },
  { value: 'unsafe', label: 'Unsafe' },
  { value: 'ignored_instructions', label: 'Ignored my instructions' },
  { value: 'other', label: 'Other' },
];

export interface MessageActionHandlers {
  onCopy: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onTakeBack: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onFeedback: (message: ChatMessage, rating: 1 | -1, reason?: string) => void;
}

interface Props extends MessageActionHandlers {
  message: ChatMessage | null;
  onClose: () => void;
}

export function MessageSheet({ message, onClose, ...handlers }: Props) {
  const { spacing: s } = useTheme();
  const [askingReason, setAskingReason] = useState(false);
  const isUser = message?.role === 'user';
  const isAnswer = message?.role === 'assistant';

  const close = () => {
    setAskingReason(false);
    onClose();
  };
  const run = (action: () => void) => {
    close();
    action();
  };

  const rows: { label: string; icon: IconName; onPress: () => void; destructive?: boolean }[] = [];
  if (message) {
    rows.push({ label: 'Copy message', icon: 'copy-outline', onPress: () => run(() => handlers.onCopy(message)) });
    if (isAnswer) {
      rows.push({ label: 'Regenerate', icon: 'refresh-outline', onPress: () => run(() => handlers.onRegenerate(message)) });
    }
    if (isUser) {
      rows.push({ label: 'Take back', icon: 'arrow-undo-outline', onPress: () => run(() => handlers.onTakeBack(message)) });
    }
    if (isAnswer && typeof message.id === 'number') {
      rows.push({ label: 'Good answer', icon: 'thumbs-up-outline', onPress: () => run(() => handlers.onFeedback(message, 1)) });
      rows.push({ label: 'Bad answer', icon: 'thumbs-down-outline', onPress: () => setAskingReason(true) });
    }
    rows.push({
      label: 'Delete message',
      icon: 'trash-outline',
      destructive: true,
      onPress: () =>
        run(() => {
          void confirm({
            title: 'Delete this message?',
            message: 'It is removed from the chat. This cannot be undone.',
            destructiveLabel: 'Delete',
          }).then((ok) => {
            if (ok) handlers.onDelete(message);
          });
        }),
    });
  }

  return (
    <Sheet visible={message !== null} onClose={close} title={askingReason ? 'What was wrong?' : undefined}>
      <View style={{ paddingBottom: s.md }}>
        {askingReason && message ? (
          FEEDBACK_REASONS.map((r) => (
            <ListRow
              key={r.value}
              title={r.label}
              onPress={() => run(() => handlers.onFeedback(message, -1, r.value))}
            />
          ))
        ) : (
          rows.map((row) => (
            <ListRow key={row.label} title={row.label} icon={row.icon} destructive={row.destructive} onPress={row.onPress} />
          ))
        )}
      </View>
    </Sheet>
  );
}

/** Copies a message's text to the clipboard. Never throws: a refused copy is not worth an error. */
export function copyText(text: string): void {
  Clipboard.setStringAsync(text).catch(() => undefined);
}

