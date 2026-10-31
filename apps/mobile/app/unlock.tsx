import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { BiometricCanceledError } from '../modules/voult-native';
import { friendlyError, useApp } from '../src/lib/app-store';
import { getRuntime } from '../src/lib/runtime';
import { OtpInput } from '../src/ui/controls';
import { useAction } from '../src/ui/hooks';
import { Button, ErrorText, Field, Screen, AuthHero, Glass } from '../src/ui/kit';
import { useTheme } from '../src/ui/theme';

export default function Unlock() {
  const { c } = useTheme();
  const { email, quick, refresh } = useApp();
  const [mode, setMode] = useState<'pin' | 'password'>(quick.pin ? 'pin' : 'password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const { busy, error, run, setError } = useAction();
  const prompted = useRef(false);

  const unlockWithBiometric = () =>
    void run(async () => {
      const rt = await getRuntime();
      try {
        await rt.setAccountKey(await rt.quick.unlockWithBiometric());
      } catch (e) {
        if (e instanceof BiometricCanceledError) return; // user chose another method
        if ((e as Error).message === 'key_invalidated') {
          await refresh();
          throw new Error(
            'Your biometrics changed. Unlock with your master password and enable it again.',
            { cause: e },
          );
        }
        throw e;
      }
      await refresh();
    });

  // Offer the biometric prompt as soon as the screen opens.
  useEffect(() => {
    if (quick.biometric && !prompted.current) {
      prompted.current = true;
      unlockWithBiometric();
    }
  }, []);

  const submitPassword = () =>
    void run(async () => {
      const rt = await getRuntime();
      await rt.accounts.unlockWithPassword(password);
      await refresh();
    });

  const submitPin = (code: string) =>
    void run(
      async () => {
        const rt = await getRuntime();
        const r = await rt.quick.unlockWithPin(code);
        if (!r.ok) {
          setPin('');
          if (r.attemptsLeft === 0) setMode('password');
          await refresh();
          throw new Error(
            r.attemptsLeft > 0
              ? `Wrong PIN. ${r.attemptsLeft} attempts left.`
              : 'Too many attempts. Use your master password.',
          );
        }
        await rt.setAccountKey(r.accountKey);
        await refresh();
      },
      (e) => (e instanceof Error ? e.message : friendlyError(e)),
    );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <AuthHero title="Vault locked" subtitle={email} />
        <Glass strong radius={26} style={{ padding: 20, gap: 16 }}>
          {mode === 'pin' && quick.pin ? (
            <>
              <Text style={{ color: c.muted, textAlign: 'center' }}>Enter your 6-digit PIN</Text>
              <OtpInput
                testID="pin"
                accessibilityLabel="PIN"
                value={pin}
                onChange={setPin}
                onComplete={submitPin}
                disabled={busy}
                autoFocus
              />
              <ErrorText>{error}</ErrorText>
            </>
          ) : (
            <>
              <Field
                label="Master password"
                testID="password"
                value={password}
                onChangeText={setPassword}
                secret
                autoComplete="current-password"
                onSubmitEditing={submitPassword}
              />
              <ErrorText>{error}</ErrorText>
              <Button
                testID="unlock-password"
                label="Unlock"
                busy={busy}
                disabled={!password}
                onPress={submitPassword}
              />
            </>
          )}

          {quick.biometric && (
            <Button
              variant="secondary"
              icon="finger-print"
              label="Use biometrics"
              onPress={unlockWithBiometric}
            />
          )}
          {quick.pin && (
            <Button
              variant="ghost"
              label={mode === 'pin' ? 'Use master password' : 'Use PIN'}
              onPress={() => {
                setError(null);
                setMode(mode === 'pin' ? 'password' : 'pin');
              }}
            />
          )}
        </Glass>
      </ScrollView>
    </Screen>
  );
}
