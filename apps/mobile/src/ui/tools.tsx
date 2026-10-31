import {
  analyzeHealth,
  breachedLogins,
  checkForUpdate,
  importFrom,
  type HealthReport,
  type ImportResult,
  type ImportSource,
  type ItemView,
  type LatestRelease,
} from '@voult/core';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, ToastAndroid, View } from 'react-native';
import { useApp } from '../lib/app-store';
import { useT } from '../lib/i18n';
import { getRuntime } from '../lib/runtime';
import { useAction } from './hooks';
import { Button, Chip, ErrorText } from './kit';
import { useTheme } from './theme';

function Group({
  title,
  items,
  extra,
}: {
  title: string;
  items: ItemView[];
  extra?: (v: ItemView) => string;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }}>
        {title} ({items.length})
      </Text>
      {items.slice(0, 20).map((v) => (
        <Pressable
          key={v.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/item/[id]', params: { id: v.id } })}
          style={{ paddingVertical: 8 }}
        >
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 15 }}>
            {v.item.title || '—'}
            {extra ? <Text style={{ color: c.muted, fontSize: 12 }}> · {extra(v)}</Text> : null}
          </Text>
        </Pressable>
      ))}
      {items.length > 20 ? <Text style={{ color: c.muted }}>+{items.length - 20}</Text> : null}
    </View>
  );
}

/** Settings → Password health: weak / reused / old locally, breaches via HIBP k-anonymity. */
export function HealthPanel() {
  const { c } = useTheme();
  const t = useT();
  const items = useApp((s) => s.items);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [breached, setBreached] = useState<{ item: ItemView; count: number }[] | null>(null);
  const { busy, error, run } = useAction();
  const muted = { color: c.muted, fontSize: 12 } as const;

  return (
    <View style={{ gap: 12 }}>
      <Text style={muted}>{t('health.intro')}</Text>
      <Button
        variant="secondary"
        label={t('health.scan')}
        onPress={() => {
          setReport(analyzeHealth(items));
          setBreached(null);
        }}
      />
      {report ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: c.foreground, fontWeight: '700', fontSize: 16 }}>
            {t('health.score')}: {report.score}/100
          </Text>
          {report.weak.length + report.reused.length + report.old.length === 0 ? (
            <Text style={muted}>{t('health.allGood')}</Text>
          ) : null}
          {report.weak.length > 0 ? <Group title={t('health.weak')} items={report.weak} /> : null}
          {report.reused.length > 0 ? (
            <Group title={t('health.reused')} items={report.reused.flat()} />
          ) : null}
          {report.old.length > 0 ? <Group title={t('health.old')} items={report.old} /> : null}
          <Text style={muted}>{t('health.breachInfo')}</Text>
          <Button
            variant="secondary"
            label={busy ? t('health.checking') : t('health.checkBreaches')}
            busy={busy}
            onPress={() =>
              void run(
                async () => setBreached(await breachedLogins(items)),
                () => t('health.breachFailed'),
              )
            }
          />
          <ErrorText>{error}</ErrorText>
          {breached ? (
            breached.length === 0 ? (
              <Text style={muted}>{t('health.allGood')}</Text>
            ) : (
              <Group
                title={t('health.breached')}
                items={breached.map((b) => b.item)}
                extra={(v) =>
                  t('health.times', { n: breached.find((b) => b.item.id === v.id)!.count })
                }
              />
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const SOURCES: { id: ImportSource; label: string }[] = [
  { id: 'chrome', label: 'Chrome / Edge' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'bitwarden', label: 'Bitwarden' },
  { id: 'onepassword', label: '1Password' },
  { id: 'proton', label: 'Proton Pass' },
];

/** Settings → Import: pick an export file from another manager, preview it, then add it. */
export function ImportPanel() {
  const { c } = useTheme();
  const t = useT();
  const vaults = useApp((s) => s.vaults);
  const [source, setSource] = useState<ImportSource>('chrome');
  const [result, setResult] = useState<ImportResult | null>(null);
  const { busy, error, run, setError } = useAction();
  const count = result?.vaults.reduce((n, v) => n + v.items.length, 0) ?? 0;
  const label = SOURCES.find((s) => s.id === source)!.label;
  const muted = { color: c.muted, fontSize: 12 } as const;

  const pick = () =>
    void run(
      async () => {
        const r = await DocumentPicker.getDocumentAsync({
          type: '*/*',
          copyToCacheDirectory: true,
        });
        if (r.canceled || !r.assets[0]) return;
        try {
          setResult(importFrom(source, await new File(r.assets[0].uri).text()));
        } catch (e) {
          setResult(null);
          throw new Error(
            e instanceof Error && /encrypted/i.test(e.message)
              ? t('import.encrypted')
              : t('import.bad', { source: label }),
            { cause: e },
          );
        }
      },
      (e) => (e instanceof Error ? e.message : 'Failed'),
    );

  const doImport = () =>
    void run(async () => {
      const vaultId = vaults[0]?.id;
      if (!vaultId || !result) return;
      const rt = await getRuntime();
      for (const v of result.vaults)
        for (const item of v.items) await rt.vault.saveItem(vaultId, item);
      ToastAndroid.show(t('import.done', { n: count }), ToastAndroid.SHORT);
      setResult(null);
    });

  return (
    <View style={{ gap: 12 }}>
      <Text style={muted}>{t('import.intro')}</Text>
      <Text style={{ color: c.foreground, fontSize: 14 }}>{t('import.source')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SOURCES.map((s) => (
          <Chip
            key={s.id}
            label={s.label}
            active={source === s.id}
            onPress={() => {
              setSource(s.id);
              setResult(null);
              setError(null);
            }}
          />
        ))}
      </View>
      <Button
        variant="secondary"
        icon="document-outline"
        label={t('import.chooseFile')}
        onPress={pick}
      />
      <ErrorText>{error}</ErrorText>
      {result ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.foreground }}>
            {t('import.found', { n: count })}
            {result.skipped.length > 0
              ? ` · ${t('import.skipped', { n: result.skipped.length })}`
              : ''}
          </Text>
          {result.skipped.slice(0, 10).map((s, i) => (
            <Text key={i} style={muted}>
              {s.title || '—'}: {s.reason}
            </Text>
          ))}
          <Button
            label={busy ? t('common.working') : t('import.run', { n: count })}
            busy={busy}
            disabled={count === 0}
            onPress={doImport}
          />
        </View>
      ) : null}
      <Text style={muted}>{t('import.warning')}</Text>
    </View>
  );
}

/** Settings → About: version and a manual "check for updates" against GitHub Releases. */
export function AboutPanel() {
  const { c } = useTheme();
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const [update, setUpdate] = useState<LatestRelease | null | 'none'>(null);
  const { busy, error, run } = useAction();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.foreground, fontSize: 16 }}>Voult {version}</Text>
      <Button
        variant="secondary"
        label="Check for updates"
        busy={busy}
        onPress={() =>
          void run(
            async () => {
              const r = await checkForUpdate(version);
              setUpdate(r.update ?? 'none');
            },
            () => 'Could not reach GitHub.',
          )
        }
      />
      <ErrorText>{error}</ErrorText>
      {update === 'none' ? (
        <Text style={{ color: c.muted }}>You have the latest version.</Text>
      ) : null}
      {update && update !== 'none' ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: c.foreground, fontWeight: '700' }}>
            Version {update.version} is available
          </Text>
          <Button
            label="Download update"
            onPress={() => void Linking.openURL(update.apkUrl ?? update.url)}
          />
        </View>
      ) : null}
      <Text style={{ color: c.muted, fontSize: 12 }}>
        Contacts GitHub only when you tap the button. Updates are installed by you from the
        downloaded file; Android asks you to confirm.
      </Text>
    </View>
  );
}
