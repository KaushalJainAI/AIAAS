import { Tabs } from 'expo-router';

import { Icon } from '../../src/components/Icon';
import { fontFamily, useTheme } from '../../src/theme';

/** Five tabs, the same on both platforms. Settings is reached from More, not from the bar. */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon name={focused ? 'pulse' : 'pulse-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="agents"
        options={{
          title: 'Agents',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon name={focused ? 'hardware-chip' : 'hardware-chip-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="files"
        options={{
          title: 'Files',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon name={focused ? 'folder' : 'folder-outline'} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ focused, color, size }) => (
            <Icon
              name={focused ? 'ellipsis-horizontal-circle' : 'ellipsis-horizontal-circle-outline'}
              color={color}
              size={size}
            />
          ),
        }}
      />
      {/* Kept as a route (More links to it); hidden from the bar. */}
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
