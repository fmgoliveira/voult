import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { useApp } from '../src/lib/app-store';
import { getRuntime } from '../src/lib/runtime';
import { useAction } from '../src/ui/hooks';
import { CheckRow } from '../src/ui/controls';
import { Button, ErrorText, Screen, AuthHero, Body, Glass } from '../src/ui/kit';
import { useTheme } from '../src/ui/theme';

export default function Recovery() {
  const { c } = useTheme();
  const { pendingRecovery, email, serverUrl, refresh } = useApp();
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const share = () =>
    void run(async () => {
      await Share.share({
        title: 'Voult recovery kit',
        message: `Voult recovery kit\nAccount: ${email}\nServer: ${serverUrl}\nRecovery secret key: ${pendingRecovery}\n\nKeep this somewhere safe and offline. Anyone with this key and your account can unlock your vault.`,
      });
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <AuthHero
          title="Save your recovery kit"
          subtitle="You need it if you ever forget your master password."
        />
        <Glass strong radius={26} style={{ padding: 20, gap: 16 }}>
          {pendingRecovery ? (
            <>
              <View
                style={{
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: c.surface,
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Text
                  testID="recovery-secret"
                  selectable
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 18,
                    textAlign: 'center',
                    color: c.foreground,
                  }}
                >
                  {pendingRecovery}
                </Text>
              </View>
              <Button
                variant="secondary"
                icon="share-outline"
                label="Save or print recovery kit"
                onPress={share}
                busy={busy}
              />
              <ErrorText>{error}</ErrorText>
            </>
          ) : (
            <Body muted>
              The secret key is only shown once, right after signup. If you did not save it you can
              still continue with your master password.
            </Body>
          )}
          <CheckRow value={saved} onValueChange={setSaved} testID="stored">
            <Text style={{ color: c.foreground, lineHeight: 21 }}>
              I stored my recovery kit somewhere safe. I understand Voult cannot reset my password.
            </Text>
          </CheckRow>
          <Button
            testID="continue"
            label="Continue"
            disabled={!saved}
            onPress={() =>
              void run(async () => {
                const rt = await getRuntime();
                await rt.accounts.confirmRecoveryKit();
                await refresh();
              })
            }
          />
        </Glass>
      </ScrollView>
    </Screen>
  );
}
