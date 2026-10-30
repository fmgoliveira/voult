import { Ionicons } from '@expo/vector-icons';
import { queryItems, type ItemType, type SortKey, type TypeFilter } from '@voult/core';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { useListQuery } from '../../../src/lib/list-query';
import {
  Chip,
  Empty,
  Glass,
  GlassIconButton,
  Logo,
  Screen,
  SearchBar,
  TypeTile,
} from '../../../src/ui/kit';
import { ItemRow, TYPE_ICON, TYPE_LABEL } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

const TYPES: ItemType[] = ['login', 'note', 'card', 'identity', 'totp'];
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Name' },
  { key: 'updated', label: 'Edited' },
  { key: 'created', label: 'Added' },
];

export default function VaultTab() {
  const { c, brand } = useTheme();
  const { items, vaults, syncing, pendingOps, email, lock } = useApp();
  const { query, patch } = useListQuery();
  const [menu, setMenu] = useState(false);
  const rows = useMemo(() => queryItems(items, query), [items, query]);
  const filtering = !!query.text || query.type !== 'all' || query.vaultId !== 'all';

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingTop: 8,
        }}
      >
        <Logo size={38} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.primary, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }}>
            Voult
          </Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>
            {syncing
              ? 'Syncing…'
              : pendingOps > 0
                ? `${pendingOps} change(s) waiting to sync`
                : email}
          </Text>
        </View>
        <GlassIconButton
          icon="lock-closed-outline"
          label="Lock vault"
          onPress={() => void lock()}
        />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SearchBar
            accessibilityLabel="Search vault"
            placeholder="Search your vault"
            value={query.text}
            onChangeText={(text) => patch({ text })}
          />
          <Pressable
            testID="add-item"
            accessibilityRole="button"
            accessibilityLabel="Add item"
            onPress={() => setMenu(true)}
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
              <Ionicons name="add" size={28} color="#fff" />
            </LinearGradient>
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          <Chip label="All" active={query.type === 'all'} onPress={() => patch({ type: 'all' })} />
          {TYPES.map((t) => (
            <Chip
              key={t}
              icon={TYPE_ICON[t]}
              label={query.type === t ? TYPE_LABEL[t] : ''}
              active={query.type === t}
              onPress={() => patch({ type: query.type === t ? 'all' : (t as TypeFilter) })}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          <Chip label="Items" active={!query.trash} onPress={() => patch({ trash: false })} />
          <Chip
            label="Trash"
            icon="trash-outline"
            active={query.trash}
            onPress={() => patch({ trash: true })}
          />
          <View style={{ width: 6 }} />
          {SORTS.map((s) => (
            <Chip
              key={s.key}
              label={s.label}
              active={query.sort === s.key}
              onPress={() => patch({ sort: s.key })}
            />
          ))}
          {vaults.length > 1 &&
            vaults.map((v) => (
              <Chip
                key={v.id}
                label={v.meta.name}
                active={query.vaultId === v.id}
                onPress={() => patch({ vaultId: query.vaultId === v.id ? 'all' : v.id })}
              />
            ))}
        </ScrollView>
      </View>

      <View style={{ flex: 1, paddingTop: 12 }}>
        {rows.length === 0 ? (
          query.trash ? (
            <Empty
              title="Trash is empty"
              body="Deleted items stay here for 30 days."
              icon="trash-outline"
            />
          ) : filtering ? (
            <Empty
              title="No matches"
              body="Try a different search or filter."
              icon="search-outline"
            />
          ) : (
            <Empty title="Your vault is empty" body="Add your first login with the + button." />
          )
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(v) => v.id}
            renderItem={({ item }) => (
              <ItemRow
                v={item}
                onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
              />
            )}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        )}
      </View>

      <Modal transparent animationType="fade" visible={menu} onRequestClose={() => setMenu(false)}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={() => setMenu(false)}
          style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end', padding: 16 }}
        >
          <Glass strong radius={26} style={{ padding: 10 }}>
            <Text
              style={{
                color: c.muted,
                fontSize: 12,
                fontWeight: '800',
                letterSpacing: 1,
                padding: 8,
              }}
            >
              NEW ITEM
            </Text>
            {TYPES.map((t) => (
              <Pressable
                key={t}
                accessibilityRole="menuitem"
                testID={`new-${t}`}
                onPress={() => {
                  setMenu(false);
                  router.push({ pathname: '/item/edit', params: { type: t } });
                }}
                android_ripple={{ color: c.border }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  padding: 10,
                  borderRadius: 16,
                }}
              >
                <TypeTile type={t} size={40} />
                <Text style={{ color: c.foreground, fontSize: 17, fontWeight: '600' }}>
                  {TYPE_LABEL[t]}
                </Text>
              </Pressable>
            ))}
          </Glass>
        </Pressable>
      </Modal>
    </Screen>
  );
}
