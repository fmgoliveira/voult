import { Ionicons } from '@expo/vector-icons';
import { matchesText, type ItemView, type LoginItem, type Totp } from '@voult/core';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '../lib/app-store';
import { getRuntime } from '../lib/runtime';
import { Glass, ItemAvatar, SearchBar } from './kit';
import { useTheme } from './theme';

const MAX_SHOWN = 6;

/** Adds a 2FA code to an existing login instead of keeping it as a separate item. */
export async function attachTotp(login: ItemView, totp: Totp): Promise<void> {
  const rt = await getRuntime();
  await rt.vault.saveLoginEdit(login, { totp });
}

/**
 * "Link to a login": pick which login a new 2FA code belongs to, or none to keep it standalone.
 * `value` is the chosen login's item id.
 */
export function LinkLogin({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { c } = useTheme();
  const items = useApp((s) => s.items);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const logins = useMemo(
    () => items.filter((v) => v.deletedAt === null && v.item.type === 'login'),
    [items],
  );
  const chosen = logins.find((v) => v.id === value);
  const shown = useMemo(
    () =>
      logins
        .filter((v) => matchesText(v, text))
        .sort((a, b) => a.item.title.localeCompare(b.item.title))
        .slice(0, MAX_SHOWN),
    [logins, text],
  );

  if (logins.length === 0) return null;

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setText('');
  };

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        testID="link-login"
        accessibilityRole="button"
        accessibilityLabel="Link to a login"
        onPress={() => setOpen(!open)}
      >
        <Glass style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
          <Ionicons name="link-outline" size={20} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.foreground, fontWeight: '700' }}>
              {chosen ? chosen.item.title : 'Link to a login'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12 }}>
              {chosen
                ? (chosen.item as LoginItem).totp
                  ? 'Replaces the 2FA code this login already has'
                  : 'The code is added to this login'
                : 'Optional: keep it with a login instead of as a separate item'}
            </Text>
          </View>
          {chosen ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove link"
              hitSlop={10}
              onPress={() => pick(null)}
            >
              <Ionicons name="close-circle" size={22} color={c.muted} />
            </Pressable>
          ) : (
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.muted} />
          )}
        </Glass>
      </Pressable>
      {open && (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row' }}>
            <SearchBar
              accessibilityLabel="Search logins"
              placeholder="Search logins"
              value={text}
              onChangeText={setText}
            />
          </View>
          {shown.map((v) => (
            <Pressable
              key={v.id}
              testID="link-option"
              accessibilityRole="button"
              accessibilityLabel={`Link to ${v.item.title}`}
              onPress={() => pick(v.id)}
            >
              <Glass
                radius={14}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}
              >
                <ItemAvatar
                  type="login"
                  title={v.item.title}
                  size={34}
                  urls={(v.item as LoginItem).urls}
                />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: c.foreground, fontWeight: '600' }}>
                    {v.item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>
                    {(v.item as LoginItem).username || (v.item as LoginItem).email}
                  </Text>
                </View>
              </Glass>
            </Pressable>
          ))}
          {shown.length === 0 && (
            <Text style={{ color: c.muted, padding: 4 }}>No logins found.</Text>
          )}
        </View>
      )}
    </View>
  );
}
