import { View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { success } from '../../lib/haptics';
import { radius, fontFamily, fontSize, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { useApproveHeldTool } from './queries';
import { useState } from 'react';
import type { HeldToolsGroup } from './types';

/**
 * Tools a connection offered that the user has not reviewed yet (a new tool, or
 * one whose description changed). Withheld until allowed. Descriptions are
 * written by whoever runs the server, so they are shown as plain text only.
 * Renders nothing when nothing is held, which is almost always.
 */
export function HeldToolsSection({ groups }: { groups: HeldToolsGroup[] }) {
  const { colors } = useTheme();
  const approve = useApproveHeldTool();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);

  const withHeld = groups.filter((g) => g.tools.length > 0);
  if (withHeld.length === 0) return null;
  const count = withHeld.reduce((n, g) => n + g.tools.length, 0);

  return (
    <Card style={{ gap: spacing.md, borderColor: colors.warning }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={typography.heading} accessibilityRole="header">
          {count === 1 ? '1 tool held for review' : `${count} tools held for review`}
        </Text>
        <Text style={[typography.caption, { color: colors.mutedText }]}>
          The assistant cannot see or use these until you allow them. Read what each one says first: a tool description is written by whoever runs that server.
        </Text>
      </View>

      {withHeld.map((group) => (
        <View key={group.server_id} style={{ gap: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.mutedText, fontFamily: fontFamily.medium }]}>{group.server_name}</Text>
          {group.tools.map((tool) => (
            <View
              key={tool.tool_name}
              style={{ gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface }}
            >
              <Text style={{ color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.mono }} selectable>
                {tool.tool_name}
              </Text>
              <Text style={[typography.caption, { color: colors.warning }]}>{tool.reason}</Text>
              {tool.description ? (
                <Text selectable style={[typography.caption, { color: colors.mutedText }]}>
                  {tool.description}
                </Text>
              ) : null}
              <Button
                title="Allow this tool"
                variant="secondary"
                loading={approve.isPending && approve.variables?.toolName === tool.tool_name}
                disabled={approve.isPending}
                onPress={() => {
                  setMessage(null);
                  approve.mutate(
                    { serverId: group.server_id, toolName: tool.tool_name },
                    {
                      onSuccess: () => {
                        success();
                        setMessage({ text: `${tool.tool_name} is allowed again`, tone: 'success' });
                      },
                      onError: (err) =>
                        setMessage({ text: errorMessage(err, 'Could not allow that tool. Please try again.'), tone: 'danger' }),
                    },
                  );
                }}
              />
            </View>
          ))}
        </View>
      ))}
      <Notice message={message?.text} tone={message?.tone} />
    </Card>
  );
}
