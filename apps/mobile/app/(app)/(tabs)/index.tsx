import { Ionicons } from '@expo/vector-icons';
import { queryItems, type ItemType, type SortKey, type TypeFilter } from '@voult/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useApp } from '../../../src/lib/app-store';
import { useListQuery } from '../../../src/lib/list-query';
import { Chip, Empty, Screen } from '../../../src/ui/kit';
import { ItemRow, TYPE_LABEL } from '../../../src/ui/items';
import { useTheme } from '../../../src/ui/theme';

const TYPES: ItemType[] = ['login', 'note', 'card', 'identity', 'totp'];
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Name' },
  { key: 'updated', label: 'Edited' },
  { key: 'created', label: 'Added' },
];

export default function VaultTab() {
  const { c } = useTheme();
  const { items, vaults, syncing, pendingOps } = useApp();
  const { query, patch } = useListQuery();
  const [menu, setMenu] = useState(false);
  const rows = useMemo(() => queryItems(items, query), [items, query]);
  const filtering = !!query.text || query.type !== 'all' || query.vaultId !== 'all';

  return (
    <Screen>
      <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
              accessibilityLabel="Search vault"
              placeholder="Search vault"
              placeholderTextColor={c.muted}
              value={query.text}
              onChangeText={(text) => patch({ text })}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: c.foreground, fontSize: 16, paddingVertical: 10 }}
            />
          </View>
          <Pressable
            testID="add-item"
            accessibilityRole="button"
            accessibilityLabel="Add item"
            onPress={() => setMenu(true)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: c.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="add" size={24} color={c.primaryForeground} />
          </Pressable>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          <Chip label="Items" active={!query.trash} onPress={() => patch({ trash: false })} />
          <Chip label="Trash" active={query.trash} onPress={() => patch({ trash: true })} />
          <View style={{ width: 8 }} />
          <Chip label="All" active={query.type === 'all'} onPress={() => patch({ type: 'all' })} />
          {TYPES.map((t) => (
            <Chip
              key={t}
              label={TYPE_LABEL[t]}
              active={query.type === t}
              onPress={() => patch({ type: t as TypeFilter })}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {SORTS.map((s) => (
            <Chip
              key={s.key}
              label={`Sort: ${s.label}`}
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

      {rows.length === 0 ? (
        query.trash ? (
          <Empty title="Trash is empty" body="Deleted items stay here for 30 days." />
        ) : filtering ? (
          <Empty title="No matches" body="Try a different search or filter." />
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
        />
      )}
      {(syncing || pendingOps > 0) && (
        <Text style={{ textAlign: 'center', color: c.muted, fontSize: 12, padding: 6 }}>
          {syncing ? 'Syncing…' : `${pendingOps} change(s) waiting to sync`}
        </Text>
      )}

      <Modal transparent animationType="fade" visible={menu} onRequestClose={() => setMenu(false)}>
        <Pressable
          accessibilityLabel="Close menu"
          onPress={() => setMenu(false)}
          style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}
        >
          <View
            style={{
              backgroundColor: c.background,
              padding: 16,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              gap: 4,
            }}
          >
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
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
                style={{ paddingVertical: 14 }}
              >
                <Text style={{ color: c.foreground, fontSize: 17 }}>{TYPE_LABEL[t]}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}
