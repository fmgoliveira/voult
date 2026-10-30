import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useApp } from '../src/lib/app-store';
import { getRuntime } from '../src/lib/runtime';
import { useAction } from '../src/ui/hooks';
import { Button, ErrorText, Field, Screen, AuthHero, Glass } from '../src/ui/kit';

export default function Reauth() {
  const { email, refresh } = useApp();
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero
          title="Session expired"
          subtitle={`Sign in again as ${email}. Your local changes are kept.`}
        />
        <Glass strong radius={26} style={{ padding: 20, gap: 16 }}>
          <Field
            label="Master password"
            value={password}
            onChangeText={setPassword}
            secret
            autoFocus
          />
          <ErrorText>{error}</ErrorText>
          <Button
            label="Sign in"
            busy={busy}
            disabled={!password}
            onPress={() =>
              void run(async () => {
                await (await getRuntime()).accounts.reauthenticate(password);
                await refresh();
              })
            }
          />
          <Button
            variant="ghost"
            label="Sign out and remove local data"
            onPress={() =>
              void run(async () => {
                await (await getRuntime()).accounts.signOut();
                await refresh();
              })
            }
          />
        </Glass>
      </ScrollView>
    </Screen>
  );
}
