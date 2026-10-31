import { Stack } from 'expo-router';
import { useTheme } from '../../src/ui/theme';

export default function AppLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="item/[id]" />
      <Stack.Screen
        name="item/edit"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="scan"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack>
  );
}
