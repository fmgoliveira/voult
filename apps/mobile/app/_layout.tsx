import '../src/polyfills';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startApp, useApp } from '../src/lib/app-store';
import { useTheme } from '../src/ui/theme';

export default function RootLayout() {
  const phase = useApp((s) => s.phase);
  const { c, dark } = useTheme();

  useEffect(() => {
    let stop: (() => void) | undefined;
    void startApp().then((fn) => (stop = fn));
    return () => stop?.();
  }, []);

  if (phase === 'booting') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.background,
        }}
      >
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Protected guard={phase === 'welcome'}>
          <Stack.Screen name="welcome" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'recovery'}>
          <Stack.Screen name="recovery" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'reauth'}>
          <Stack.Screen name="reauth" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'locked'}>
          <Stack.Screen name="unlock" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'ready'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
