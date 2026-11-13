import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';

import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { AgentView } from '../../../../src/features/imagine/AgentView';
import { StudioView } from '../../../../src/features/imagine/StudioView';
import { spacing } from '../../../../src/theme';

type View_ = 'agent' | 'studio';

/** Imagine: the agent that plans a generation for you, or the studio where you set every dial. */
export default function ImagineRoute() {
  const [view, setView] = useState<View_>('agent');
  return (
    <Screen edges={['left', 'right', 'bottom']} style={{ padding: 0 }}>
      <Stack.Screen options={{ title: 'Imagine' }} />
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
        <SegmentedControl<View_>
          items={[
            { key: 'agent', label: 'Agent', count: 0 },
            { key: 'studio', label: 'Studio', count: 0 },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      <View style={{ flex: 1 }}>{view === 'studio' ? <StudioView /> : <AgentView />}</View>
    </Screen>
  );
}
