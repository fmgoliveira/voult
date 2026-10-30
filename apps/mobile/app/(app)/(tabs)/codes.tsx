import { Ionicons } from '@expo/vector-icons';
import { matchesText } from '@voult/core';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { Empty, Glass, ItemAvatar, Screen, SearchBar } from '../../../src/ui/kit';
import { TotpCode } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

export default function Codes() {
  const { c, brand } = useTheme();
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
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 4 }}>
        <Text style={{ color: c.foreground, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>
          Codes
        </Text>
        <Text style={{ color: c.muted, fontSize: 13 }}>Tap a code to copy it</Text>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          paddingBottom: 12,
        }}
      >
        <SearchBar
          accessibilityLabel="Search codes"
          placeholder="Search codes"
          value={text}
          onChangeText={setText}
        />
        <Pressable
          testID="scan-qr"
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
          onPress={() => router.push('/scan')}
          style={{
            shadowColor: brand[0],
            shadowOpacity: 0.5,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 5,
          }}
        >
          <LinearGradient
            colors={[brand[0], brand[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="qr-code-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Empty
          title="No 2FA codes yet"
          body="Scan a QR code or add a secret key."
          icon="qr-code-outline"
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.v.id}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item: r }) => (
            <Glass style={{ marginHorizontal: 16, marginBottom: 10, padding: 14, gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: r.v.id } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <ItemAvatar type={r.v.item.type} title={r.v.item.title} size={26} />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: c.muted, fontSize: 13, fontWeight: '600' }}
                >
                  {r.v.item.title}
                  {r.totp.account ? ` · ${r.totp.account}` : ''}
                </Text>
              </Pressable>
              <TotpCode entry={r.totp} showNext />
            </Glass>
          )}
        />
      )}
    </Screen>
  );
}
