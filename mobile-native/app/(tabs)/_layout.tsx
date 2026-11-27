import { Tabs } from 'expo-router';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { Icon, type IconName } from '../../src/components/Icon';
import { fontFamily, useTheme } from '../../src/theme';

/** The active tab's icon sits on a soft pill, so where you are reads at a glance. */
function TabIcon({ tab, focused, color }: { tab: keyof typeof TAB_ICONS; focused: boolean; color: ColorValue }) {
  const { colors } = useTheme();
  const name = focused ? TAB_ICONS[tab].active : TAB_ICONS[tab].idle;
  return (
    <View style={[styles.pill, focused && { backgroundColor: colors.primaryBg }]}>
      <Icon name={name} color={color} size={22} />
    </View>
  );
}

/** Each tab's icon: outline when idle, filled when open. */
const TAB_ICONS: Record<string, { idle: IconName; active: IconName }> = {
  chat: { idle: 'chatbubble-ellipses-outline', active: 'chatbubble-ellipses' },
  inbox: { idle: 'pulse-outline', active: 'pulse' },
  agents: { idle: 'cube-outline', active: 'cube' },
  files: { idle: 'folder-open-outline', active: 'folder-open' },
  more: { idle: 'grid-outline', active: 'grid' },
};

function iconFor(tab: keyof typeof TAB_ICONS) {
  return function TabBarIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    return <TabIcon tab={tab} focused={focused} color={color} />;
  };
}

/** Five tabs, the same on both platforms. Settings is reached from More, not from the bar. */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: 6,
        },
        tabBarItemStyle: { gap: 2 },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: iconFor('chat') }} />
      <Tabs.Screen name="inbox" options={{ title: 'Activity', tabBarIcon: iconFor('inbox') }} />
      <Tabs.Screen name="agents" options={{ title: 'Agents', tabBarIcon: iconFor('agents') }} />
      <Tabs.Screen name="files" options={{ title: 'Files', tabBarIcon: iconFor('files') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: iconFor('more') }} />
      {/* Kept as a route (More links to it); hidden from the bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
