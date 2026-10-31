import { parseOtpQr, type Totp } from '@voult/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../../src/lib/app-store';
import { getRuntime } from '../../src/lib/runtime';
import { useAction } from '../../src/ui/hooks';
import { Body, Button, ErrorText, Screen } from '../../src/ui/kit';
import { useTheme } from '../../src/ui/theme';

/** Scans otpauth:// and Google Authenticator export QR codes and saves them as 2FA items. */
export default function Scan() {
  const { c } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const vaultId = useApp((s) => s.vaults[0]?.id);
  const [found, setFound] = useState<Totp[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = useRef(false);
  const { busy, error, run } = useAction();

  if (!permission)
    return (
      <Screen>
        <View />
      </Screen>
    );
  if (!permission.granted) {
    return (
      <Screen>
        <View style={{ padding: 24, gap: 16 }}>
          <Body>Voult needs the camera to scan 2FA QR codes. Nothing is recorded or stored.</Body>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (found) {
    return (
      <Screen>
        <View style={{ padding: 24, gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={{ color: c.foreground, fontSize: 20, fontWeight: '700' }}
          >
            Found {found.length} code{found.length === 1 ? '' : 's'}
          </Text>
          {found.map((t, i) => (
            <Text key={i} style={{ color: c.muted }}>
              {[t.issuer, t.account].filter(Boolean).join(' · ') || 'Unnamed'}
            </Text>
          ))}
          <ErrorText>{error}</ErrorText>
          <Button
            testID="add-scanned"
            label={found.length > 1 ? 'Add all' : 'Add'}
            busy={busy}
            onPress={() =>
              void run(async () => {
                if (!vaultId) throw new Error('No vault yet. Wait for the first sync to finish.');
                const rt = await getRuntime();
                for (const t of found) {
                  const now = Date.now();
                  await rt.vault.saveItem(vaultId, {
                    type: 'totp',
                    title: t.issuer || t.account || 'Authenticator',
                    notes: '',
                    favorite: false,
                    pinned: false,
                    createdAt: now,
                    updatedAt: now,
                    totp: t,
                  });
                }
                router.back();
              })
            }
          />
          <Button
            variant="ghost"
            label="Scan again"
            onPress={() => {
              locked.current = false;
              setFound(null);
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (locked.current) return;
          try {
            const totps = parseOtpQr(data);
            locked.current = true;
            setProblem(null);
            setFound(totps);
          } catch {
            setProblem('That QR code is not a 2FA code.');
          }
        }}
      />
      <View style={{ position: 'absolute', bottom: 32, left: 24, right: 24, gap: 12 }}>
        {problem ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: '#fff',
              textAlign: 'center',
              backgroundColor: '#000a',
              padding: 8,
              borderRadius: 8,
            }}
          >
            {problem}
          </Text>
        ) : null}
        <Button variant="secondary" label="Cancel" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
