import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Glass } from '../../../src/ui/kit';
import { useTheme } from '../../../src/ui/theme';

const TABS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  index: { label: 'Vault', icon: 'lock-closed' },
  codes: { label: 'Codes', icon: 'shield-checkmark' },
  generator: { label: 'Generate', icon: 'key' },
  settings: { label: 'Settings', icon: 'settings' },
};

interface RouteNav {
  emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
    defaultPrevented: boolean;
  };
  navigate: (name: string) => void;
}

interface BarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  /** Each route's own navigation object (the bar-level `navigation` prop is not passed by every version). */
  descriptors: Record<string, { navigation: RouteNav }>;
}

/** Floating glass pill instead of the default full-width bar. */
function FloatingTabBar({ state, descriptors }: BarProps) {
  const { c, brand } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}
    >
      <Glass strong radius={24} style={{ flexDirection: 'row', padding: 6 }}>
        {state.routes.map((route, i) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const active = state.index === i;
          const onPress = () => {
            const navigation = descriptors[route.key]?.navigation;
            if (!navigation) return;
            const e = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!active && !e.defaultPrevented) navigation.navigate(route.name);
          };
          const inner = (
            <>
              <Ionicons
                name={
                  active ? meta.icon : (`${meta.icon}-outline` as keyof typeof Ionicons.glyphMap)
                }
                size={20}
                color={active ? '#fff' : c.muted}
              />
              <Text style={{ color: active ? '#fff' : c.muted, fontSize: 11, fontWeight: '700' }}>
                {meta.label}
              </Text>
            </>
          );
          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name === 'index' ? 'vault' : route.name}`}
              accessibilityRole="tab"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected: active }}
              onPress={onPress}
              style={{ flex: 1 }}
            >
              {active ? (
                <LinearGradient
                  colors={[brand[0], brand[1]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: 18 }}
                >
                  {inner}
                </LinearGradient>
              ) : (
                <View style={{ alignItems: 'center', gap: 2, paddingVertical: 8 }}>{inner}</View>
              )}
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(p) => <FloatingTabBar {...(p as unknown as BarProps)} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Vault' }} />
      <Tabs.Screen name="codes" options={{ title: 'Codes' }} />
      <Tabs.Screen name="generator" options={{ title: 'Generate' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
