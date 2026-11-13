import { router, Stack } from 'expo-router';
import { ScrollView } from 'react-native';

import { ListRow } from '../../../src/components/ListRow';
import { Screen } from '../../../src/components/Screen';
import { Section } from '../../../src/components/Section';
import { MORE_GROUPS } from '../../../src/features/more/areas';
import { spacing } from '../../../src/theme';

export default function MoreScreen() {
  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'More' }} />
      <ScrollView contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        {MORE_GROUPS.map((group) => (
          <Section key={group.title} title={group.title}>
            {group.items.map((item) => (
              <ListRow
                key={item.href}
                title={item.label}
                icon={item.icon}
                onPress={() => router.push(item.href)}
              />
            ))}
          </Section>
        ))}
      </ScrollView>
    </Screen>
  );
}
