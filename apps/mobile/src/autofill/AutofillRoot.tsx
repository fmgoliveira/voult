import {
  DEFAULT_RANDOM_OPTIONS,
  androidAppUrl,
  blankItem,
  generatePassword,
  identifierOf,
  inferIdentifier,
  siteNameFromUrl,
  parseCreateRequest,
  parseGetRequest,
  type ItemView,
  type LoginItem,
} from '@voult/core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Native from '../../modules/voult-native';
import { enforceAutoLock, friendlyError, isAppStarted, useApp } from '../lib/app-store';
import { getRuntime } from '../lib/runtime';
import { CheckRow } from '../ui/controls';
import { useAction } from '../ui/hooks';
import { GeneratorSheet } from '../ui/generator';
import {
  AuthHero,
  Body,
  Button,
  ErrorText,
  Field,
  Glass,
  IconButton,
  ItemAvatar,
  Logo,
  Screen,
  SearchBar,
} from '../ui/kit';
import { useTheme } from '../ui/theme';
import { UnlockPanel } from '../ui/unlock-panel';
import {
  createResponse,
  fillValues,
  getResponse,
  linkApp,
  loginsFor,
  loginsForRp,
  resolveCaller,
  type CredentialRequest,
  type FillRequest,
  type LaunchRequest,
} from './flows';

/**
 * The screen the system opens over another app (autofill) or from Credential Manager (passkeys).
 * It runs inside the app's own React instance, so a running, unlocked app answers instantly and a
 * cold start boots the same bundle.
 */
export function AutofillRoot() {
  return (
    <SafeAreaProvider>
      <Flow />
    </SafeAreaProvider>
  );
}

type Finish = (result: unknown | null) => Promise<void>;

function Flow() {
  const phase = useApp((s) => s.phase);
  const email = useApp((s) => s.email);
  const [req, setReq] = useState<LaunchRequest | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      await useApp.getState().refresh();
      await enforceAutoLock();
      await useApp.getState().refresh();
      let r: LaunchRequest | null = null;
      for (let i = 0; i < 10 && !r; i++) {
        r = await Native.getLaunchRequest<LaunchRequest>();
        if (!r) await new Promise((res) => setTimeout(res, 150));
      }
      setReq(r);
      if (!r) Native.finishLaunch(null);
    })();
  }, []);

  const finish: Finish = async (result) => {
    // A process started only for this screen has no auto-lock timer: do not leave the key around.
    if (!isAppStarted()) await (await getRuntime()).clearAccountKey();
    Native.finishLaunch(result);
  };
  const cancel = () => void finish(null);

  // Autofill is a bottom drawer over the other app; passkeys use a full screen.
  const isFill = req?.kind === 'fill';
  const frame = (children: ReactNode) =>
    isFill ? <Drawer onClose={cancel}>{children}</Drawer> : <Shell>{children}</Shell>;

  if (req === undefined || phase === 'booting') {
    return <Shell>{null}</Shell>;
  }
  if (req === null) return null;
  if (phase === 'welcome' || phase === 'reauth' || phase === 'recovery') {
    return frame(
      <>
        <DrawerTitle
          title="Finish setting up Voult"
          subtitle="Open the Voult app and sign in first, then try again."
        />
        <Button variant="secondary" label="Close" onPress={cancel} />
      </>,
    );
  }
  if (phase === 'locked') {
    return frame(
      <>
        <DrawerTitle title="Unlock Voult" subtitle={email} />
        <UnlockPanel />
        <Button variant="ghost" label="Cancel" onPress={cancel} />
      </>,
    );
  }
  return req.kind === 'fill' ? (
    <FillFlow req={req} finish={finish} cancel={cancel} />
  ) : (
    <CredentialFlow req={req} finish={finish} cancel={cancel} />
  );
}

/** Bottom sheet over the app being filled; tapping outside closes it. */
// The drawer slides in once; later steps (unlock -> list) swap content without replaying it.
let drawerEntered = false;

function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(drawerEntered ? 1 : 0)).current;
  useEffect(() => {
    if (drawerEntered) return;
    drawerEntered = true;
    Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);
  const close = () =>
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose());
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View
        style={{
          ...(StyleSheet.absoluteFill as object),
          backgroundColor: 'rgba(0,0,0,0.4)',
          opacity: progress,
        }}
      >
        <Pressable accessibilityLabel="Close" onPress={close} style={{ flex: 1 }} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding">
        <Animated.View
          style={{
            transform: [
              {
                translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }),
              },
            ],
          }}
        >
          <View
            style={{
              backgroundColor: c.surfaceSolid,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: height * 0.85,
              paddingBottom: insets.bottom,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: c.borderStrong,
                marginTop: 10,
              }}
            />
            <ScrollView
              contentContainerStyle={{ padding: 16, gap: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

function DrawerTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Logo size={36} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.foreground, fontSize: 18, fontWeight: '800' }}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </Screen>
  );
}

function Message({ title, text, onCancel }: { title: string; text: string; onCancel: () => void }) {
  return (
    <Shell>
      <AuthHero title={title} subtitle={text} />
      <Button variant="secondary" label="Close" onPress={onCancel} />
    </Shell>
  );
}

// ------------------------------------------------------------------ autofill

function FillFlow({
  req,
  finish,
  cancel,
}: {
  req: FillRequest;
  finish: Finish;
  cancel: () => void;
}) {
  const { c } = useTheme();
  const items = useApp((s) => s.items);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remember, setRemember] = useState(true);
  const { error, run } = useAction();
  const canLink = !!req.package && !req.host;

  const fill = (v: ItemView) =>
    void run(async () => {
      const login = v.item as LoginItem;
      if (remember && canLink) {
        const rt = await getRuntime();
        await rt.vault.saveLoginEdit(v, { urls: linkApp(login, req.package!) });
      }
      await finish(fillValues(login));
    });

  const { matches, others } = useMemo(() => loginsFor(items, req), [items, req]);
  if (creating) return <NewLoginFlow req={req} finish={finish} cancel={() => setCreating(false)} />;

  const q = query.trim().toLowerCase();
  const filtered = others.filter((v) => {
    const l = v.item as LoginItem;
    return !q || l.title.toLowerCase().includes(q) || identifierOf(l).toLowerCase().includes(q);
  });

  const row = (v: ItemView) => {
    const l = v.item as LoginItem;
    return (
      <Pressable
        key={v.id}
        accessibilityRole="button"
        accessibilityLabel={`Fill ${l.title}`}
        onPress={() => fill(v)}
        android_ripple={{ color: c.border }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
      >
        <ItemAvatar type="login" title={l.title} urls={l.urls} size={40} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontWeight: '700', fontSize: 16 }}>
            {l.title || 'Untitled'}
          </Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
            {identifierOf(l)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.muted} />
      </Pressable>
    );
  };

  const action = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: c.border }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.primary + '1f',
        }}
      >
        <Ionicons name={icon} size={20} color={c.primary} />
      </View>
      <Text style={{ color: c.foreground, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );

  return (
    <Drawer onClose={cancel}>
      <DrawerTitle title="Fill with Voult" subtitle={req.label ?? undefined} />
      <ErrorText>{error}</ErrorText>
      {req.signUp ? action('sparkles-outline', 'Create new login', () => setCreating(true)) : null}
      {matches.map(row)}
      {matches.length === 0 && !req.signUp ? (
        <Body muted>No saved login for {req.label ?? 'this site'}.</Body>
      ) : null}
      {canLink ? (
        <CheckRow value={remember} onValueChange={setRemember}>
          <Body>Suggest the login I pick for this app from now on</Body>
        </CheckRow>
      ) : null}
      {showAll ? (
        <>
          <View style={{ flexDirection: 'row' }}>
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Search logins"
              accessibilityLabel="Search logins"
            />
          </View>
          {filtered.length === 0 ? <Body muted>Nothing found.</Body> : filtered.map(row)}
        </>
      ) : (
        action('search-outline', 'Search all logins', () => setShowAll(true))
      )}
    </Drawer>
  );
}

/** "Create new login": generate a password, save the login for this site/app, fill the form. */
function NewLoginFlow({
  req,
  finish,
  cancel,
}: {
  req: FillRequest;
  finish: Finish;
  cancel: () => void;
}) {
  const vaults = useApp((s) => s.vaults);
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(() =>
    req.host ? siteNameFromUrl(`https://${req.host}`) : (req.label ?? ''),
  );
  const [who, setWho] = useState('');
  const [password, setPassword] = useState(() => generatePassword(DEFAULT_RANDOM_OPTIONS));
  const [generating, setGenerating] = useState(false);

  const save = () =>
    void run(async () => {
      const vaultId = vaults[0]?.id;
      if (!vaultId) throw new Error('No vault yet. Open Voult and wait for it to sync.');
      if (!title.trim()) throw new Error('Give it a title.');
      const now = Date.now();
      const url = req.host ? `https://${req.host}` : req.package ? androidAppUrl(req.package) : '';
      const rt = await getRuntime();
      await rt.vault.saveItem(vaultId, {
        ...(blankItem('login') as LoginItem),
        title: title.trim(),
        ...inferIdentifier(who),
        password,
        urls: url ? [{ url, match: 'domain' }] : [],
        createdAt: now,
        updatedAt: now,
      });
      await finish({ username: who, password });
    });

  return (
    <Drawer onClose={cancel}>
      <DrawerTitle title="New login" subtitle={req.label ?? undefined} />
      <Field label="Title" value={title} onChangeText={setTitle} />
      {req.wantsUsername ? (
        <Field
          label="Email or username"
          value={who}
          onChangeText={setWho}
          keyboardType="email-address"
          autoComplete="off"
        />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        <View style={{ flex: 1 }}>
          <Field label="Password" value={password} onChangeText={setPassword} secret />
        </View>
        <IconButton
          icon="sparkles-outline"
          label="Generate password"
          onPress={() => setGenerating(true)}
        />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Save and fill" busy={busy} disabled={!password} onPress={save} />
      <Button variant="ghost" label="Cancel" onPress={cancel} />
      <GeneratorSheet
        visible={generating}
        onClose={() => setGenerating(false)}
        onUse={(pw) => setPassword(pw)}
      />
    </Drawer>
  );
}

// ------------------------------------------------------------------ Credential Manager

function CredentialFlow({
  req,
  finish,
  cancel,
}: {
  req: CredentialRequest;
  finish: Finish;
  cancel: () => void;
}) {
  const items = useApp((s) => s.items);
  const vaults = useApp((s) => s.vaults);
  const { busy, error, run } = useAction();

  if (req.error) {
    return (
      <Message title="Cannot continue" text="The request could not be read." onCancel={cancel} />
    );
  }

  // ---- passkey
  if (req.type === 'passkey' && req.requestJson) {
    return req.op === 'create' ? (
      <PasskeyCreate
        req={req}
        items={items}
        vaultId={vaults[0]?.id}
        finish={finish}
        cancel={cancel}
      />
    ) : (
      <PasskeyGet req={req} items={items} finish={finish} cancel={cancel} />
    );
  }

  // ---- password
  if (req.op === 'create') {
    const title = req.callerLabel || req.callerPackage;
    return (
      <Shell>
        <AuthHero title="Save password?" subtitle={`${req.id ?? ''} for ${title}`} />
        <ErrorText>{error}</ErrorText>
        <Button
          label="Save in Voult"
          busy={busy}
          onPress={() =>
            void run(async () => {
              const vaultId = vaults[0]?.id;
              if (!vaultId) throw new Error('No vault yet. Open Voult and wait for it to sync.');
              const now = Date.now();
              const rt = await getRuntime();
              await rt.vault.saveItem(vaultId, {
                ...(blankItem('login') as LoginItem),
                title,
                username: req.id ?? '',
                password: req.password ?? '',
                urls: [{ url: androidAppUrl(req.callerPackage), match: 'domain' }],
                createdAt: now,
                updatedAt: now,
              });
              await finish({ type: 'password' });
            })
          }
        />
        <Button variant="ghost" label="Cancel" onPress={cancel} />
      </Shell>
    );
  }
  const view = items.find((i) => i.id === req.itemId && i.item.type === 'login');
  if (!view) {
    return <Message title="Login not found" text="It may have been deleted." onCancel={cancel} />;
  }
  const login = view.item as LoginItem;
  return (
    <Shell>
      <AuthHero
        title="Use this login?"
        subtitle={`${identifierOf(login)} for ${req.callerLabel}`}
      />
      <Button
        label="Continue"
        onPress={() =>
          void finish({
            type: 'password',
            id: fillValues(login).username,
            password: login.password,
          })
        }
      />
      <Button variant="ghost" label="Cancel" onPress={cancel} />
    </Shell>
  );
}

function PasskeyCreate({
  req,
  items,
  vaultId,
  finish,
  cancel,
}: {
  req: CredentialRequest;
  items: ItemView[];
  vaultId: string | undefined;
  finish: Finish;
  cancel: () => void;
}) {
  const { c } = useTheme();
  const { busy, error, run } = useAction();
  const parsed = useMemo(() => parseCreateRequest(req.requestJson!), [req.requestJson]);
  const candidates = useMemo(() => loginsForRp(items, parsed.rpId), [items, parsed.rpId]);
  const [target, setTarget] = useState<string>(candidates[0]?.id ?? 'new');
  const caller = resolveCaller(req, parsed.rpId);

  if (!caller.ok)
    return <Message title="Cannot save passkey" text={caller.reason} onCancel={cancel} />;
  if (parsed.algorithms.length > 0 && !parsed.algorithms.includes(-7)) {
    return (
      <Message
        title="Passkey type not supported"
        text="This site asks for a passkey type Voult cannot create yet."
        onCancel={cancel}
      />
    );
  }
  const known = new Set(parsed.excludeCredentials);
  const duplicate = items.some(
    (i) => i.item.type === 'login' && i.item.passkeys.some((k) => known.has(k.credentialId)),
  );
  if (duplicate) {
    return (
      <Message
        title="Passkey already saved"
        text="Voult already has a passkey for this account."
        onCancel={cancel}
      />
    );
  }

  const save = () =>
    void run(
      async () => {
        const { passkey, response } = createResponse(parsed, caller);
        const rt = await getRuntime();
        const existing = candidates.find((v) => v.id === target);
        if (existing) {
          const login = existing.item as LoginItem;
          await rt.vault.saveLoginEdit(existing, { passkeys: [...login.passkeys, passkey] });
        } else {
          if (!vaultId) throw new Error('No vault yet. Open Voult and wait for it to sync.');
          const now = Date.now();
          await rt.vault.saveItem(vaultId, {
            ...(blankItem('login') as LoginItem),
            title: parsed.rpName || parsed.rpId,
            username: parsed.user.name,
            urls: [{ url: `https://${parsed.rpId}`, match: 'domain' }],
            passkeys: [passkey],
            createdAt: now,
            updatedAt: now,
          });
        }
        await finish({ type: 'passkey', response });
      },
      (e) => (e instanceof Error && e.message.includes('vault') ? e.message : friendlyError(e)),
    );

  return (
    <Shell>
      <AuthHero
        title="Save a passkey?"
        subtitle={`${parsed.user.name || 'Your account'} on ${parsed.rpName || parsed.rpId}`}
      />
      <Glass radius={18} style={{ padding: 12, gap: 10 }}>
        <Text style={{ color: c.muted, fontSize: 12, fontWeight: '800' }}>SAVE TO</Text>
        {candidates.map((v) => (
          <CheckRow key={v.id} value={target === v.id} onValueChange={() => setTarget(v.id)}>
            <Body>
              Add to {v.item.title} ({identifierOf(v.item as LoginItem) || 'no username'})
            </Body>
          </CheckRow>
        ))}
        <CheckRow value={target === 'new'} onValueChange={() => setTarget('new')}>
          <Body>A new login</Body>
        </CheckRow>
      </Glass>
      <ErrorText>{error}</ErrorText>
      <Button label="Save passkey" busy={busy} onPress={save} />
      <Button variant="ghost" label="Cancel" onPress={cancel} />
    </Shell>
  );
}

function PasskeyGet({
  req,
  items,
  finish,
  cancel,
}: {
  req: CredentialRequest;
  items: ItemView[];
  finish: Finish;
  cancel: () => void;
}) {
  const { busy, error, run } = useAction();
  const parsed = useMemo(() => parseGetRequest(req.requestJson!), [req.requestJson]);
  const caller = resolveCaller(req, parsed.rpId);
  const view = items.find((i) => i.id === req.itemId && i.item.type === 'login');
  const login = view?.item as LoginItem | undefined;
  const passkey = login?.passkeys.find((k) => k.credentialId === req.credentialId);

  if (!caller.ok) return <Message title="Cannot sign in" text={caller.reason} onCancel={cancel} />;
  if (!view || !login || !passkey) {
    return <Message title="Passkey not found" text="It may have been removed." onCancel={cancel} />;
  }
  return (
    <Shell>
      <AuthHero
        title="Sign in with passkey?"
        subtitle={`${passkey.userName || login.title} on ${passkey.rpName || passkey.rpId}`}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Continue"
        busy={busy}
        onPress={() =>
          void run(async () => {
            const { updated, response } = getResponse(passkey, parsed, caller);
            const rt = await getRuntime();
            await rt.vault.saveLoginEdit(view, {
              passkeys: login.passkeys.map((k) =>
                k.credentialId === updated.credentialId ? updated : k,
              ),
            });
            await finish({ type: 'passkey', response });
          })
        }
      />
      <Button variant="ghost" label="Cancel" onPress={cancel} />
    </Shell>
  );
}
