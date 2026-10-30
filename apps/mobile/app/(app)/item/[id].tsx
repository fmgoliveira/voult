import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { copySecret } from '../../../src/lib/clipboard';
import { getRuntime } from '../../../src/lib/runtime';
import { Body, Button, IconButton, Screen } from '../../../src/ui/kit';
import { TYPE_LABEL, TotpCode } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

function Line({
  label,
  value,
  secret,
  mono,
  children,
}: {
  label: string;
  value: string;
  secret?: boolean;
  mono?: boolean;
  children?: ReactNode;
}) {
  const { c } = useTheme();
  const [shown, setShown] = useState(false);
  if (!value && !children) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        paddingVertical: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
        {children ?? (
          <Text
            testID={`field-${label.toLowerCase()}`}
            style={{
              color: c.foreground,
              fontSize: 16,
              fontFamily: mono || secret ? 'monospace' : undefined,
            }}
          >
            {secret && !shown ? '••••••••••••' : value}
          </Text>
        )}
      </View>
      {secret ? (
        <IconButton
          icon={shown ? 'eye-off-outline' : 'eye-outline'}
          label={shown ? `Hide ${label}` : `Show ${label}`}
          onPress={() => setShown(!shown)}
        />
      ) : null}
      {value ? (
        <IconButton
          icon="copy-outline"
          label={`Copy ${label}`}
          onPress={() => copySecret(value, `${label} copied`)}
        />
      ) : null}
    </View>
  );
}

export default function ItemDetail() {
  const { c } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const view = useApp((s) => s.items.find((i) => i.id === id));
  if (!view) {
    // Deleted or purged elsewhere while this screen was open.
    return (
      <Screen>
        <Body muted style={{ padding: 24 }}>
          This item is no longer available.
        </Body>
        <Button label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }
  const i = view.item;
  const trashed = view.deletedAt !== null;

  const act = (fn: (rt: Awaited<ReturnType<typeof getRuntime>>) => Promise<void>) => async () => {
    await fn(await getRuntime());
    router.back();
  };

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <IconButton
          icon="arrow-back"
          label="Back"
          onPress={() => router.back()}
          color={c.foreground}
        />
        <View style={{ flex: 1 }}>
          <Text
            testID="detail-title"
            numberOfLines={1}
            style={{ color: c.foreground, fontSize: 18, fontWeight: '700' }}
          >
            {i.title || 'Untitled'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {TYPE_LABEL[i.type]}
            {view.dirty ? ' · not synced yet' : ''}
          </Text>
        </View>
        {!trashed && (
          <IconButton
            icon={i.favorite ? 'star' : 'star-outline'}
            label={i.favorite ? 'Remove from favourites' : 'Add to favourites'}
            color={i.favorite ? c.primary : c.muted}
            onPress={async () =>
              (await getRuntime()).vault
                .saveItem(view.vaultId, { ...i, favorite: !i.favorite }, view.id)
                .then(() => undefined)
            }
          />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {i.type === 'login' && (
          <>
            <Line label="Username" value={i.username} />
            <Line label="Email" value={i.email} />
            <Line label="Password" value={i.password} secret />
            {i.totp ? (
              <Line label="One-time code" value="">
                <TotpCode entry={i.totp} showNext />
              </Line>
            ) : null}
            {i.urls.map((u, n) => (
              <Line key={n} label={n === 0 ? 'Website' : `Website ${n + 1}`} value={u.url}>
                <Text
                  accessibilityRole="link"
                  onPress={() =>
                    void Linking.openURL(u.url.includes('://') ? u.url : `https://${u.url}`)
                  }
                  style={{ color: c.primary, fontSize: 16, textDecorationLine: 'underline' }}
                >
                  {u.url}
                </Text>
              </Line>
            ))}
            {i.customFields.map((f, n) =>
              f.type === 'totp' ? (
                <Line key={n} label={f.name} value="">
                  <TotpCode entry={f.value} />
                </Line>
              ) : (
                <Line key={n} label={f.name} value={f.value} secret={f.type === 'hidden'} />
              ),
            )}
          </>
        )}
        {i.type === 'card' && (
          <>
            <Line label="Cardholder" value={i.holder} />
            <Line label="Number" value={i.number} mono />
            <Line label="Expiry" value={i.expiry} />
            <Line label="CVV" value={i.cvv} secret />
            <Line label="PIN" value={i.pin} secret />
          </>
        )}
        {i.type === 'identity' && (
          <>
            <Line label="Full name" value={i.fullName} />
            <Line label="Email" value={i.email} />
            <Line label="Phone" value={i.phone} />
            <Line label="Address" value={i.address} />
            <Line label="Birthday" value={i.birthday} />
          </>
        )}
        {i.type === 'totp' && (
          <>
            <Line label="Issuer" value={i.totp.issuer} />
            <Line label="Account" value={i.totp.account} />
            <Line label="One-time code" value="">
              <TotpCode entry={i.totp} showNext />
            </Line>
          </>
        )}
        {i.notes ? (
          <View style={{ paddingVertical: 10 }}>
            <Text style={{ color: c.muted, fontSize: 12 }}>Notes</Text>
            <Text testID="field-notes" selectable style={{ color: c.foreground, fontSize: 16 }}>
              {i.notes}
            </Text>
          </View>
        ) : null}
        {i.type === 'login' && i.passkeys.length > 0 && (
          <View accessibilityLabel="Passkeys" style={{ paddingVertical: 10, gap: 6 }}>
            <Text style={{ color: c.muted, fontSize: 12 }}>Passkeys</Text>
            {i.passkeys.map((k) => (
              <View
                key={k.credentialId}
                style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
              >
                <Ionicons name="key-outline" size={16} color={c.muted} />
                <Text style={{ flex: 1, color: c.foreground }} numberOfLines={1}>
                  {k.rpName || k.rpId}
                  {k.userName ? ` · ${k.userName}` : ''}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {new Date(k.createdAt).toLocaleDateString()}
                </Text>
              </View>
            ))}
          </View>
        )}
        {i.type === 'login' && i.passwordHistory.length > 0 && (
          <View style={{ paddingVertical: 10 }}>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              Password history ({i.passwordHistory.length})
            </Text>
            {i.passwordHistory.map((h, n) => (
              <Line
                key={n}
                label={new Date(h.changedAt).toLocaleString()}
                value={h.password}
                secret
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: c.border,
        }}
      >
        {trashed ? (
          <>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                icon="refresh"
                label="Restore"
                onPress={act((rt) => rt.vault.restoreItem(view))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="danger"
                label="Delete forever"
                onPress={() =>
                  Alert.alert('Delete forever?', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => void act((rt) => rt.vault.purgeItem(view))(),
                    },
                  ])
                }
              />
            </View>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Button
                testID="edit"
                label="Edit"
                onPress={() => router.push({ pathname: '/item/edit', params: { id: view.id } })}
              />
            </View>
            <Button
              variant="secondary"
              icon="trash-outline"
              label="Trash"
              onPress={act((rt) => rt.vault.trashItem(view))}
            />
          </>
        )}
      </View>
    </Screen>
  );
}
