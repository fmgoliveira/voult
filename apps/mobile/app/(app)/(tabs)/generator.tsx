import { ScrollView, Text, View } from 'react-native';
import { GeneratorPanel } from '../../../src/ui/generator';
import { Screen } from '../../../src/ui/kit';
import { useTheme } from '../../../src/ui/theme';

export default function Generator() {
  const { c } = useTheme();
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text
            style={{ color: c.foreground, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 }}
          >
            Generator
          </Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>
            Strong, random passwords and passphrases.
          </Text>
        </View>
        <GeneratorPanel />
      </ScrollView>
    </Screen>
  );
}
