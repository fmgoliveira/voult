import {
  blankItem,
  identifierOf,
  identifierSuggestions,
  inferIdentifier,
  itemSchema,
  parseTotpInput,
  type Item,
  type ItemType,
  type LoginItem,
} from '@voult/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { takeDraftSeed } from '../../../src/lib/autofill';
import { getRuntime } from '../../../src/lib/runtime';
import { useAction } from '../../../src/ui/hooks';
import { Toggle } from '../../../src/ui/controls';
import { GeneratorSheet } from '../../../src/ui/generator';
import { Button, ErrorText, Field, IconButton, Screen, TypeTile } from '../../../src/ui/kit';
import { TYPE_LABEL } from '../../../src/ui/items';
import { attachTotp, LinkLogin } from '../../../src/ui/link-login';
import { useTheme } from '../../../src/ui/theme';

type Draft = Item & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One input for "email or username": we work out which it is, and offer ones already in use. */
function IdentifierField({
  login,
  onChange,
}: {
  login: { username: string; email: string };
  onChange: (v: { username: string; email: string }) => void;
}) {
  const { c } = useTheme();
  const items = useApp((s) => s.items);
  const [focused, setFocused] = useState(false);
  const value = identifierOf(login);
  const suggestions = useMemo(
    () =>
      identifierSuggestions(
        items.map((i) => i.item),
        value,
      ),
    [items, value],
  );
  return (
    <View style={{ gap: 6 }}>
      <Field
        testID="input-identifier"
        label="Email or username"
        value={value}
        icon={inferIdentifier(value).email ? 'mail-outline' : 'person-outline'}
        keyboardType="email-address"
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChangeText={(v) => onChange(inferIdentifier(v))}
      />
      {focused && suggestions.length > 0 ? (
        <View
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surfaceSolid,
            overflow: 'hidden',
          }}
        >
          {suggestions.map((s, n) => (
            <Pressable
              key={s.value}
              accessibilityRole="button"
              accessibilityLabel={`Use ${s.value}, ${s.count} accounts`}
              onPress={() => onChange(inferIdentifier(s.value))}
              android_ripple={{ color: c.border }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: n === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              <Text numberOfLines={1} style={{ flex: 1, color: c.foreground, fontSize: 15 }}>
                {s.value}
              </Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>
                {s.count} {s.count === 1 ? 'account' : 'accounts'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function EditItem() {
  const { c } = useTheme();
  const params = useLocalSearchParams<{ id?: string; type?: ItemType }>();
  const { items, vaults } = useApp();
  const existing = params.id ? items.find((i) => i.id === params.id) : undefined;
  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return existing.item as Draft;
    const base = blankItem(params.type ?? 'login') as Draft;
    const seed = base.type === 'login' ? takeDraftSeed() : null; // from the autofill save prompt
    return seed
      ? ({
          ...base,
          title: seed.title,
          password: seed.password,
          urls: seed.urls,
          ...inferIdentifier(seed.username),
        } as Draft)
      : base;
  });
  const [totpText, setTotpText] = useState(() => {
    const it = existing?.item;
    return (it?.type === 'login' || it?.type === 'totp' ? it.totp?.secret : '') ?? '';
  });
  const [generating, setGenerating] = useState(false);
  const [linkId, setLinkId] = useState<string | null>(null);
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
        // A linked code lives on the login, so it needs no title of its own.
        const linkTarget =
          !existing && next.type === 'totp' ? items.find((i) => i.id === linkId) : undefined;
        if (linkTarget && !next.title.trim()) next = { ...next, title: linkTarget.item.title };
        if (!next.title.trim()) throw new Error('Give it a title.');
        const parsed = itemSchema.safeParse(next);
        if (!parsed.success) throw new Error('Some fields are invalid.');
        if (!vaultId) throw new Error('No vault yet. Wait for the first sync to finish.');
        const rt = await getRuntime();
        const target =
          !existing && next.type === 'totp' && linkId
            ? items.find((i) => i.id === linkId)
            : undefined;
        if (target && next.type === 'totp') {
          // Linked: the code lives on the login rather than as its own item.
          await attachTotp(target, next.totp);
          router.back();
          router.push({ pathname: '/item/[id]', params: { id: target.id } });
          return;
        }
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
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 }}>
        <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <TypeTile type={draft.type} size={28} />
          <Text style={{ color: c.foreground, fontWeight: '800', fontSize: 16 }}>
            {existing ? 'Edit' : 'New'} {TYPE_LABEL[draft.type].toLowerCase()}
          </Text>
        </View>
        <Button testID="save" label="Save" busy={busy} onPress={save} />
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {text('Title', 'title', { autoCapitalize: 'sentences' })}

          {draft.type === 'login' && (
            <>
              <IdentifierField
                login={{ username: draft.username, email: draft.email }}
                onChange={(v) => patch(v)}
              />
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
                  onPress={() => setGenerating(true)}
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
              {!existing && <LinkLogin value={linkId} onChange={setLinkId} />}
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
            <Toggle
              value={draft.favorite}
              onValueChange={(v) => patch({ favorite: v })}
              accessibilityLabel="Favourite"
            />
            <Text style={{ color: c.foreground }}>Favourite</Text>
          </View>
          <ErrorText>{error}</ErrorText>
        </ScrollView>
      </KeyboardAvoidingView>
      <GeneratorSheet
        visible={generating}
        onClose={() => setGenerating(false)}
        onUse={(password) => patch({ password })}
      />
    </Screen>
  );
}
