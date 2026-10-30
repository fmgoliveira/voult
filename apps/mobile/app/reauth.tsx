import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useApp } from '../src/lib/app-store';
import { getRuntime } from '../src/lib/runtime';
import { useAction } from '../src/ui/hooks';
import { Body, Button, ErrorText, Field, Heading, Screen } from '../src/ui/kit';

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
        <View style={{ gap: 4, paddingTop: 32 }}>
          <Heading>Session expired</Heading>
          <Body muted>Sign in again as {email}. Your local changes are kept.</Body>
        </View>
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
      </ScrollView>
    </Screen>
  );
}
