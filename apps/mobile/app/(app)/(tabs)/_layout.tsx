import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTheme } from '../../../src/ui/theme';

const icon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.background, borderTopColor: c.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Vault',
          tabBarIcon: icon('lock-closed-outline'),
          tabBarButtonTestID: 'tab-vault',
        }}
      />
      <Tabs.Screen
        name="codes"
        options={{
          title: 'Codes',
          tabBarIcon: icon('shield-checkmark-outline'),
          tabBarButtonTestID: 'tab-codes',
        }}
      />
      <Tabs.Screen
        name="generator"
        options={{
          title: 'Generate',
          tabBarIcon: icon('key-outline'),
          tabBarButtonTestID: 'tab-generator',
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: icon('settings-outline'),
          tabBarButtonTestID: 'tab-settings',
        }}
      />
    </Tabs>
  );
}
