import { Text, View, useColorScheme } from 'react-native';
import { colors } from '@voult/ui-tokens';

export default function Index() {
  const c = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.background,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: '600', color: c.foreground }}>Voult</Text>
      <Text style={{ color: c.muted }}>Vault locked. Onboarding comes in phase 6.</Text>
    </View>
  );
}
