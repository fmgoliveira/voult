import { Ionicons } from '@expo/vector-icons';
import { matchesText } from '@voult/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { Empty, Screen } from '../../../src/ui/kit';
import { TotpCode } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

export default function Codes() {
  const { c } = useTheme();
  const items = useApp((s) => s.items);
  const [text, setText] = useState('');

  const rows = useMemo(
    () =>
      items
        .filter((v) => v.deletedAt === null)
        .flatMap((v) => {
          const i = v.item;
          if (i.type === 'totp') return [{ v, totp: i.totp }];
          if (i.type === 'login' && i.totp) return [{ v, totp: i.totp }];
          return [];
        })
        .filter((r) => matchesText(r.v, text))
        .sort((a, b) => a.v.item.title.localeCompare(b.v.item.title)),
    [items, text],
  );

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          padding: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput
            accessibilityLabel="Search codes"
            placeholder="Search codes"
            placeholderTextColor={c.muted}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            style={{ flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 10 }}
          />
        </View>
        <Pressable
          testID="scan-qr"
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
          onPress={() => router.push('/scan')}
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="qr-code-outline" size={22} color={c.primaryForeground} />
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Empty title="No 2FA codes yet" body="Scan a QR code or add a secret key." />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.v.id}
          renderItem={({ item: r }) => (
            <View
              style={{ padding: 16, gap: 6, borderBottomWidth: 1, borderBottomColor: c.border }}
            >
              <Text
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: r.v.id } })}
                numberOfLines={1}
                style={{ color: c.muted, fontSize: 13 }}
              >
                {r.v.item.title}
                {r.totp.account ? ` · ${r.totp.account}` : ''}
              </Text>
              <TotpCode entry={r.totp} showNext />
            </View>
          )}
        />
      )}
    </Screen>
  );
}
