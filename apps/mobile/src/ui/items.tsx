import { Ionicons } from '@expo/vector-icons';
import {
  currentCode,
  hostOf,
  nextCode,
  type Item,
  type ItemType,
  type ItemView,
  type Totp,
} from '@voult/core';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { copySecret } from '../lib/clipboard';
import { useNow } from './hooks';
import { IconButton } from './kit';
import { useTheme } from './theme';

export const TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure note',
  card: 'Card',
  identity: 'Identity',
  totp: '2FA code',
};

const TYPE_ICON: Record<ItemType, keyof typeof Ionicons.glyphMap> = {
  login: 'globe-outline',
  note: 'document-text-outline',
  card: 'card-outline',
  identity: 'person-outline',
  totp: 'shield-checkmark-outline',
};

export function subtitle(i: Item): string {
  switch (i.type) {
    case 'login':
      return i.username || i.email || (i.urls[0] ? hostOf(i.urls[0].url) : '');
    case 'card':
      return i.number ? `•••• ${i.number.slice(-4)}` : i.holder;
    case 'identity':
      return i.fullName || i.email;
    case 'totp':
      return i.totp.issuer || i.totp.account;
    default:
      return '';
  }
}

export function ItemRow({ v, onPress }: { v: ItemView; onPress: () => void }) {
  const { c } = useTheme();
  const i = v.item;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      }}
    >
      <Pressable
        testID="item-row"
        accessibilityRole="button"
        accessibilityLabel={`${i.title || 'Untitled'}, ${TYPE_LABEL[i.type]}${subtitle(i) ? `, ${subtitle(i)}` : ''}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          gap: 12,
          alignItems: 'center',
          padding: 14,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: c.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={TYPE_ICON[i.type]} size={20} color={c.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 16, fontWeight: '600' }}>
            {i.title || 'Untitled'}
            {i.favorite ? ' ★' : ''}
            {v.dirty ? ' •' : ''}
          </Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
            {subtitle(i)}
          </Text>
        </View>
      </Pressable>
      {i.type === 'login' && i.username ? (
        <IconButton
          icon="person-outline"
          label={`Copy username for ${i.title}`}
          onPress={() => copySecret(i.username, 'Username copied')}
        />
      ) : null}
      {i.type === 'login' && i.password ? (
        <IconButton
          icon="key-outline"
          label={`Copy password for ${i.title}`}
          onPress={() => copySecret(i.password, 'Password copied')}
        />
      ) : null}
    </View>
  );
}

const group = (code: string) =>
  code.length === 6
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : code.length === 8
      ? `${code.slice(0, 4)} ${code.slice(4)}`
      : code;

/** Live code with a draining bar; tap to copy. */
export function TotpCode({ entry, showNext }: { entry: Totp; showNext?: boolean }) {
  const { c } = useTheme();
  const now = useNow();
  const state = useMemo(() => {
    try {
      return {
        ...currentCode(entry, now),
        next: entry.kind === 'totp' ? nextCode(entry, now) : '',
      };
    } catch {
      return null;
    }
  }, [entry, now]);
  if (!state) return <Text style={{ color: c.danger }}>Invalid secret</Text>;
  const low = entry.kind === 'totp' && state.remaining <= 5;
  return (
    <View style={{ gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One-time code ${state.code.split('').join(' ')}, ${state.remaining} seconds left. Tap to copy`}
        onPress={() => copySecret(state.code, 'Code copied')}
        style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}
      >
        <Text
          testID="totp-code"
          style={{
            fontFamily: 'monospace',
            fontSize: 28,
            letterSpacing: 2,
            color: low ? c.danger : c.foreground,
          }}
        >
          {group(state.code)}
        </Text>
        {showNext && state.next ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>next {group(state.next)}</Text>
        ) : null}
      </Pressable>
      {entry.kind === 'totp' && (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}>
          <View
            style={{
              height: 4,
              width: `${(1 - state.progress) * 100}%`,
              backgroundColor: low ? c.danger : c.primary,
            }}
          />
        </View>
      )}
    </View>
  );
}
