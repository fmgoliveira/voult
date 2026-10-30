import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useApp } from '../src/lib/app-store';
import { getRuntime } from '../src/lib/runtime';
import { DEFAULT_SERVER_URL } from '../src/lib/settings';
import { useAction } from '../src/ui/hooks';
import { Button, ErrorText, Field, Screen, AuthHero, Glass } from '../src/ui/kit';

const MIN_PASSWORD = 12;

export default function Welcome() {
  const refresh = useApp((s) => s.refresh);
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const { busy, error, run, setError } = useAction();

  const submit = () =>
    void run(async () => {
      const rt = await getRuntime();
      if (mode === 'create') {
        if (password.length < MIN_PASSWORD)
          throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
        if (password !== confirm) throw new Error('Passwords do not match.');
        await rt.accounts.createNewAccount({ email, password, serverUrl });
      } else {
        await rt.accounts.signIn({ email, password, serverUrl });
      }
      await refresh();
    });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 24, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <AuthHero
            title={mode === 'create' ? 'Create your vault' : 'Sign in'}
            subtitle="Zero-knowledge: your master password never leaves this device."
          />
          <Glass strong radius={26} style={{ padding: 20, gap: 16 }}>
            <Field
              label="Email"
              testID="email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label="Master password"
              testID="password"
              value={password}
              onChangeText={setPassword}
              secret
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              hint={
                mode === 'create'
                  ? `At least ${MIN_PASSWORD} characters. It cannot be reset.`
                  : undefined
              }
            />
            {mode === 'create' && (
              <Field
                label="Confirm master password"
                testID="confirm"
                value={confirm}
                onChangeText={setConfirm}
                secret
              />
            )}
            <Field
              label="Server URL"
              testID="server"
              value={serverUrl}
              onChangeText={setServerUrl}
              keyboardType="url"
            />
            <ErrorText>{error}</ErrorText>
            <Button
              testID="submit"
              label={mode === 'create' ? 'Create account' : 'Sign in'}
              busy={busy}
              disabled={!email || !password}
              onPress={submit}
            />
            <Button
              variant="ghost"
              label={mode === 'create' ? 'I already have an account' : 'Create a new account'}
              onPress={() => {
                setError(null);
                setMode(mode === 'create' ? 'signin' : 'create');
              }}
            />
          </Glass>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
