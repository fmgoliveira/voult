import { androidAppUrl, siteNameFromUrl, type LoginItem } from '@voult/core';
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Native from '../../modules/voult-native';
import { setDraftSeed } from '../../src/lib/autofill';
import { useTheme } from '../../src/ui/theme';

/** A login captured by the autofill save prompt in another app: open the new-login form with it. */
function openPendingSave() {
  const p = Native.takePendingSave();
  if (!p) return;
  const urls: LoginItem['urls'] = [];
  if (p.host) urls.push({ url: `https://${p.host}`, match: 'domain' });
  else if (p.package) urls.push({ url: androidAppUrl(p.package), match: 'domain' });
  setDraftSeed({
    title: (p.host ? siteNameFromUrl(`https://${p.host}`) : p.package?.split('.').pop()) ?? '',
    username: p.username,
    password: p.password,
    urls,
  });
  router.push({ pathname: '/item/edit', params: { type: 'login' } });
}

export default function AppLayout() {
  const { c } = useTheme();

  useEffect(() => {
    openPendingSave();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') openPendingSave();
    });
    return () => sub.remove();
  }, []);

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
