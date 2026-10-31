import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { copySecret } from '../../../src/lib/clipboard';
import { getRuntime } from '../../../src/lib/runtime';
import {
  Body,
  Button,
  Glass,
  GlassIconButton,
  IconButton,
  ItemAvatar,
  Screen,
} from '../../../src/ui/kit';
import { ConfirmSheet } from '../../../src/ui/controls';
import { TYPE_LABEL, TotpCode } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

function Line({
  label,
  value,
  secret,
  mono,
  last,
  children,
}: {
  label: string;
  value: string;
  secret?: boolean;
  mono?: boolean;
  last?: boolean;
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
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
          {label}
        </Text>
        {children ?? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy ${label}`}
            onPress={() => copySecret(value, `${label} copied`)}
            android_ripple={{ color: c.border }}
            style={{
              marginHorizontal: -6,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 8,
            }}
          >
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
          </Pressable>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removePasskey, setRemovePasskey] = useState<string | null>(null);
  if (!view) {
    // Deleted or purged elsewhere while this screen was open.
    return (
      <Screen>
        <View style={{ padding: 24, gap: 16 }}>
          <Body muted>This item is no longer available.</Body>
          <Button label="Back" onPress={() => router.back()} />
        </View>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <GlassIconButton icon="arrow-back" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }} />
        {!trashed && (
          <GlassIconButton
            icon={i.favorite ? 'star' : 'star-outline'}
            label={i.favorite ? 'Remove from favourites' : 'Add to favourites'}
            color={i.favorite ? '#fbbf24' : c.foreground}
            onPress={async () =>
              void (await getRuntime()).vault.saveItem(
                view.vaultId,
                { ...i, favorite: !i.favorite },
                view.id,
              )
            }
          />
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>
        <View style={{ alignItems: 'center', gap: 6, paddingBottom: 4 }}>
          <ItemAvatar
            type={i.type}
            title={i.title}
            size={72}
            urls={i.type === 'login' ? i.urls : undefined}
          />
          <Text
            testID="detail-title"
            numberOfLines={2}
            style={{
              color: c.foreground,
              fontSize: 22,
              fontWeight: '800',
              textAlign: 'center',
              letterSpacing: -0.4,
            }}
          >
            {i.title || 'Untitled'}
          </Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>
            {TYPE_LABEL[i.type]}
            {view.dirty ? ' · not synced yet' : ''}
          </Text>
        </View>

        <Glass>
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
                    style={{ color: c.primary, fontSize: 16, fontWeight: '600' }}
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
              <Line label="PIN" value={i.pin} secret last />
            </>
          )}
          {i.type === 'identity' && (
            <>
              <Line label="Full name" value={i.fullName} />
              <Line label="Email" value={i.email} />
              <Line label="Phone" value={i.phone} />
              <Line label="Address" value={i.address} />
              <Line label="Birthday" value={i.birthday} last />
            </>
          )}
          {i.type === 'totp' && (
            <>
              <Line label="Issuer" value={i.totp.issuer} />
              <Line label="Account" value={i.totp.account} />
              <Line label="One-time code" value="" last>
                <TotpCode entry={i.totp} showNext />
              </Line>
            </>
          )}
        </Glass>

        {i.notes ? (
          <Glass style={{ padding: 16, gap: 4 }}>
            <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}>
              NOTES
            </Text>
            <Text testID="field-notes" selectable style={{ color: c.foreground, fontSize: 16 }}>
              {i.notes}
            </Text>
          </Glass>
        ) : null}

        {i.type === 'login' && i.passkeys.length > 0 && (
          <Glass style={{ padding: 16, gap: 8 }}>
            <Text
              accessibilityLabel="Passkeys"
              style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 }}
            >
              PASSKEYS
            </Text>
            {i.passkeys.map((k) => (
              <View
                key={k.credentialId}
                style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}
              >
                <Ionicons name="key" size={16} color={c.primary} />
                <Text style={{ flex: 1, color: c.foreground }} numberOfLines={1}>
                  {k.rpName || k.rpId}
                  {k.userName ? ` · ${k.userName}` : ''}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>
                  {new Date(k.createdAt).toLocaleDateString()}
                </Text>
                <IconButton
                  icon="trash-outline"
                  label={`Remove passkey for ${k.rpName || k.rpId}`}
                  color={c.danger}
                  onPress={() => setRemovePasskey(k.credentialId)}
                />
              </View>
            ))}
            <ConfirmSheet
              visible={removePasskey !== null}
              title="Remove this passkey?"
              message="It is deleted from this login on all your devices. You may no longer be able to sign in to the site with it, unless you have another way in."
              confirmLabel="Remove passkey"
              destructive
              onClose={() => setRemovePasskey(null)}
              onConfirm={() =>
                void getRuntime().then((rt) =>
                  rt.vault.saveLoginEdit(view, {
                    passkeys: i.passkeys.filter((k) => k.credentialId !== removePasskey),
                  }),
                )
              }
            />
          </Glass>
        )}

        {i.type === 'login' && i.passwordHistory.length > 0 && (
          <Glass>
            <Text
              style={{
                color: c.muted,
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.4,
                padding: 16,
                paddingBottom: 4,
              }}
            >
              PASSWORD HISTORY ({i.passwordHistory.length})
            </Text>
            {i.passwordHistory.map((h, n) => (
              <Line
                key={n}
                label={new Date(h.changedAt).toLocaleString()}
                value={h.password}
                secret
                last={n === i.passwordHistory.length - 1}
              />
            ))}
          </Glass>
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, padding: 14 }}>
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
                onPress={() => setConfirmDelete(true)}
              />
              <ConfirmSheet
                visible={confirmDelete}
                title="Delete forever?"
                message="This cannot be undone."
                confirmLabel="Delete"
                destructive
                onClose={() => setConfirmDelete(false)}
                onConfirm={() => void act((rt) => rt.vault.purgeItem(view))()}
              />
            </View>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <Button
                testID="edit"
                icon="create-outline"
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
