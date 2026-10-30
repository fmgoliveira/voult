import {
  blankItem,
  generatePassword,
  itemSchema,
  parseTotpInput,
  type Item,
  type ItemType,
  type LoginItem,
} from '@voult/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { getRuntime } from '../../../src/lib/runtime';
import { useAction } from '../../../src/ui/hooks';
import { Button, ErrorText, Field, IconButton, Screen } from '../../../src/ui/kit';
import { TYPE_LABEL } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

type Draft = Item & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function EditItem() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ id?: string; type?: ItemType }>();
  const { items, vaults } = useApp();
  const existing = params.id ? items.find((i) => i.id === params.id) : undefined;
  const [draft, setDraft] = useState<Draft>(
    () => (existing?.item ?? blankItem(params.type ?? 'login')) as Draft,
  );
  const [totpText, setTotpText] = useState(() => {
    const it = existing?.item;
    return (it?.type === 'login' || it?.type === 'totp' ? it.totp?.secret : '') ?? '';
  });
  const vaultId = existing?.vaultId ?? vaults[0]?.id ?? '';
  const { busy, error, run } = useAction();

  const patch = (p: Record<string, unknown>) => setDraft((d) => ({ ...d, ...p }) as Draft);
  const text = (label: string, key: string, extra: object = {}) => (
    <Field
      testID={`input-${key}`}
      label={label}
      value={String(draft[key] ?? '')}
      onChangeText={(v) => patch({ [key]: v })}
      {...extra}
    />
  );

  const save = () =>
    void run(
      async () => {
        let next = draft as Item;
        if (next.type === 'login') next = { ...next, totp: parseTotpInput(totpText, next.totp) };
        if (next.type === 'totp') {
          const t = parseTotpInput(totpText, next.totp);
          if (!t) throw new Error('Enter the secret key or an otpauth:// link.');
          next = { ...next, totp: t };
        }
        if (!next.title.trim()) throw new Error('Give it a title.');
        const parsed = itemSchema.safeParse(next);
        if (!parsed.success) throw new Error('Some fields are invalid.');
        if (!vaultId) throw new Error('No vault yet. Wait for the first sync to finish.');
        const rt = await getRuntime();
        let id: string;
        if (existing && parsed.data.type === 'login') {
          await rt.vault.saveLoginEdit(existing, parsed.data);
          id = existing.id;
        } else {
          id = await rt.vault.saveItem(vaultId, parsed.data, existing?.id);
        }
        router.back();
        if (!existing) router.push({ pathname: '/item/[id]', params: { id } });
      },
      (e) =>
        e instanceof Error && e.message === 'recovery_kit_required'
          ? 'Confirm your recovery kit first.'
          : e instanceof Error
            ? e.message
            : 'Could not save.',
    );

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
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            color: c.foreground,
            fontWeight: '600',
            fontSize: 16,
          }}
        >
          {existing ? 'Edit' : 'New'} {TYPE_LABEL[draft.type].toLowerCase()}
        </Text>
        <Button testID="save" label="Save" busy={busy} onPress={save} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {text('Title', 'title', { autoCapitalize: 'sentences' })}

          {draft.type === 'login' && (
            <>
              {text('Username', 'username')}
              {text('Email', 'email', { keyboardType: 'email-address' })}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    testID="input-password"
                    label="Password"
                    value={draft.password}
                    onChangeText={(v) => patch({ password: v })}
                    secret
                  />
                </View>
                <IconButton
                  icon="sparkles-outline"
                  label="Generate password"
                  onPress={() => patch({ password: generatePassword({ length: 20 }) })}
                />
              </View>
              {(draft.urls as LoginItem['urls']).map((u, n) => (
                <View key={n} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={`Website ${n + 1}`}
                      value={u.url}
                      keyboardType="url"
                      placeholder="https://example.com"
                      onChangeText={(v) =>
                        patch({
                          urls: draft.urls.map((x: LoginItem['urls'][number], j: number) =>
                            j === n ? { ...x, url: v } : x,
                          ),
                        })
                      }
                    />
                  </View>
                  <IconButton
                    icon="trash-outline"
                    label="Remove website"
                    onPress={() =>
                      patch({ urls: draft.urls.filter((_: unknown, j: number) => j !== n) })
                    }
                  />
                </View>
              ))}
              <Button
                variant="secondary"
                icon="add"
                label="Add website"
                onPress={() => patch({ urls: [...draft.urls, { url: '', match: 'domain' }] })}
              />
              <Field
                label="2FA secret key or otpauth:// link"
                value={totpText}
                onChangeText={setTotpText}
                autoComplete="off"
              />
            </>
          )}

          {draft.type === 'totp' && (
            <>
              <Field
                label="Secret key or otpauth:// link"
                value={totpText}
                onChangeText={setTotpText}
              />
              <Field
                label="Issuer"
                value={draft.totp.issuer}
                onChangeText={(v) => patch({ totp: { ...draft.totp, issuer: v } })}
              />
              <Field
                label="Account"
                value={draft.totp.account}
                onChangeText={(v) => patch({ totp: { ...draft.totp, account: v } })}
              />
            </>
          )}

          {draft.type === 'card' && (
            <>
              {text('Cardholder', 'holder')}
              {text('Number', 'number', { keyboardType: 'number-pad' })}
              {text('Expiry (MM/YY)', 'expiry')}
              {text('CVV', 'cvv', { secret: true, keyboardType: 'number-pad' })}
              {text('PIN', 'pin', { secret: true, keyboardType: 'number-pad' })}
            </>
          )}

          {draft.type === 'identity' && (
            <>
              {text('Full name', 'fullName')}
              {text('Email', 'email', { keyboardType: 'email-address' })}
              {text('Phone', 'phone', { keyboardType: 'phone-pad' })}
              {text('Address', 'address')}
              {text('Birthday', 'birthday')}
            </>
          )}

          <Field
            label="Notes"
            value={draft.notes}
            onChangeText={(v) => patch({ notes: v })}
            multiline
            numberOfLines={4}
            style={{ minHeight: 90, textAlignVertical: 'top' }}
            autoCapitalize="sentences"
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Switch
              value={draft.favorite}
              onValueChange={(v) => patch({ favorite: v })}
              accessibilityLabel="Favourite"
            />
            <Text style={{ color: c.foreground }}>Favourite</Text>
          </View>
          <ErrorText>{error}</ErrorText>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
