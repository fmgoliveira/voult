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
import { useId, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { copySecret } from '../lib/clipboard';
import { useNow } from './hooks';
import { Glass, IconButton, ItemAvatar } from './kit';
import { useTheme } from './theme';

export const TYPE_LABEL: Record<ItemType, string> = {
  login: 'Login',
  note: 'Secure note',
  card: 'Card',
  identity: 'Identity',
  totp: '2FA code',
};

export const TYPE_ICON: Record<ItemType, keyof typeof Ionicons.glyphMap> = {
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
    <Glass radius={18} style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable
          testID="item-row"
          accessibilityRole="button"
          accessibilityLabel={`${i.title || 'Untitled'}, ${TYPE_LABEL[i.type]}${subtitle(i) ? `, ${subtitle(i)}` : ''}`}
          onPress={onPress}
          android_ripple={{ color: c.border }}
          style={{ flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12 }}
        >
          <ItemAvatar type={i.type} title={i.title} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, color: c.foreground, fontSize: 16, fontWeight: '700' }}
              >
                {i.title || 'Untitled'}
              </Text>
              {i.favorite ? <Ionicons name="star" size={13} color="#fbbf24" /> : null}
              {v.dirty ? (
                <View
                  accessibilityLabel="Not synced yet"
                  style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fbbf24' }}
                />
              ) : null}
            </View>
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
    </Glass>
  );
}

const group = (code: string) =>
  code.length === 6
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : code.length === 8
      ? `${code.slice(0, 4)} ${code.slice(4)}`
      : code;

/** Circular countdown with the seconds in the middle. */
function Ring({ remaining, progress, low }: { remaining: number; progress: number; low: boolean }) {
  const { c, dark } = useTheme();
  const id = useId().replace(/:/g, '');
  const r = 17;
  const circ = 2 * Math.PI * r;
  const [a, b] = low
    ? ['#fb7185', '#e11d48']
    : dark
      ? ['#7c74ff', '#c084fc']
      : ['#6d5bf7', '#a35cf6'];
  return (
    <Svg
      width={46}
      height={46}
      viewBox="0 0 46 46"
      accessibilityLabel={`${remaining} seconds left`}
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={a} />
          <Stop offset="1" stopColor={b} />
        </LinearGradient>
      </Defs>
      <Circle cx="23" cy="23" r={r} fill="none" stroke={c.border} strokeWidth={4} />
      <Circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${circ}`}
        strokeDashoffset={circ * progress}
        transform="rotate(-90 23 23)"
      />
      <SvgText
        x="23"
        y="27.5"
        fontSize="13"
        fontWeight="700"
        textAnchor="middle"
        fill={low ? c.danger : c.foreground}
      >
        {remaining}
      </SvgText>
    </Svg>
  );
}

/** Live code with a countdown ring; tap to copy. */
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`One-time code ${state.code.split('').join(' ')}, ${state.remaining} seconds left. Tap to copy`}
      onPress={() => copySecret(state.code, 'Code copied')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
    >
      {entry.kind === 'totp' ? (
        <Ring remaining={state.remaining} progress={state.progress} low={low} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          testID="totp-code"
          style={{
            fontFamily: 'monospace',
            fontSize: 30,
            fontWeight: '700',
            letterSpacing: 3,
            color: low ? c.danger : c.foreground,
          }}
        >
          {group(state.code)}
        </Text>
        {showNext && state.next ? (
          <Text style={{ color: c.muted, fontSize: 12 }}>next {group(state.next)}</Text>
        ) : null}
      </View>
      <Ionicons name="copy-outline" size={20} color={c.muted} />
    </Pressable>
  );
}
