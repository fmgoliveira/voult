import { ScrollView } from 'react-native';
import { useApp } from '../src/lib/app-store';
import { AuthHero, Screen } from '../src/ui/kit';
import { UnlockPanel } from '../src/ui/unlock-panel';

export default function Unlock() {
  const email = useApp((s) => s.email);
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero title="Vault locked" subtitle={email} />
        <UnlockPanel />
      </ScrollView>
    </Screen>
  );
}
