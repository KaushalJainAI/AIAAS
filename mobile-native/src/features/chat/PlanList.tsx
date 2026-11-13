/** The plan as a checklist: done, doing, blocked, open. Same marks as the web's plan dock. */
import { StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { radius, spacing, typography, useTheme } from '../../theme';
import type { TodoItem } from './types';

const MARK: Record<TodoItem['status'], string> = {
  done: '✓',
  doing: '●',
  blocked: '!',
  open: '○',
};

export function PlanList({ todos }: { todos: TodoItem[] }) {
  const { colors, spacing: s } = useTheme();
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === 'done').length;
  return (
    <View style={[styles.plan, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md }]}>
      <Text style={[typography.caption, { color: colors.mutedText, fontWeight: '600' }]}>
        {`Plan · ${done}/${todos.length} done`}
      </Text>
      {todos.map((todo, i) => {
        const color = todo.status === 'blocked' ? colors.danger : todo.status === 'done' ? colors.mutedText : colors.text;
        return (
          <View key={`${i}-${todo.text}`} style={{ flexDirection: 'row', gap: s.sm }}>
            <Text style={[typography.body, { width: 16, color, textAlign: 'center' }]}>{MARK[todo.status]}</Text>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  typography.body,
                  { color, textDecorationLine: todo.status === 'done' ? 'line-through' : 'none' },
                ]}
              >
                {todo.text}
              </Text>
              {todo.note ? <Text style={[typography.caption, { color: colors.mutedText }]}>{todo.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  plan: { borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
});
