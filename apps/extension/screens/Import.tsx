import { importFrom, type ImportResult, type ImportSource, type VaultView } from '@voult/core';
import { useState } from 'react';
import { Button, ErrorText, Field, Select, useToast } from '../components/ui';
import { useAsyncAction } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { saveItem } from '../lib/vault';

const SOURCES: { id: ImportSource; label: string; accept: string }[] = [
  { id: 'chrome', label: 'Chrome / Edge / Brave (CSV)', accept: '.csv' },
  { id: 'firefox', label: 'Firefox (CSV)', accept: '.csv' },
  { id: 'bitwarden', label: 'Bitwarden (JSON)', accept: '.json' },
  { id: 'onepassword', label: '1Password (CSV)', accept: '.csv' },
  { id: 'proton', label: 'Proton Pass (JSON)', accept: '.json' },
];

/** Settings → Import: pick an export file from another manager, preview it, then add it. */
export function ImportPanel({ vaults }: { vaults: VaultView[] }) {
  const t = useT();
  const [source, setSource] = useState<ImportSource>('chrome');
  const [result, setResult] = useState<ImportResult | null>(null);
  const { busy, error, run, setError } = useAsyncAction();
  const meta = SOURCES.find((s) => s.id === source)!;
  const count = result?.vaults.reduce((n, v) => n + v.items.length, 0) ?? 0;

  const pick = (file: File | undefined) => {
    setResult(null);
    if (!file) return;
    void run(
      async () => {
        let r: ImportResult;
        try {
          r = importFrom(source, await file.text());
        } catch (e) {
          throw new Error(
            e instanceof Error && /encrypted/i.test(e.message)
              ? t('import.encrypted')
              : t('import.bad', { source: meta.label }),
            { cause: e },
          );
        }
        setResult(r);
      },
      (e) => (e instanceof Error ? e.message : 'Failed'),
    );
  };

  const doImport = () =>
    void run(async () => {
      const vaultId = vaults[0]?.id;
      if (!vaultId || !result) return;
      for (const v of result.vaults) for (const item of v.items) await saveItem(vaultId, item);
      useToast.getState().show(t('import.done', { n: count }));
      setResult(null);
    });

  return (
    <>
      <p className="text-xs text-muted">{t('import.intro')}</p>
      <Field label={t('import.source')}>
        {(id) => (
          <Select
            id={id}
            value={source}
            onChange={(e) => {
              setSource(e.target.value as ImportSource);
              setResult(null);
              setError(null);
            }}
          >
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t('import.chooseFile')}>
        {(id) => (
          <input
            id={id}
            key={source}
            type="file"
            accept={meta.accept}
            onChange={(e) => pick(e.target.files?.[0])}
            className="w-full text-xs"
          />
        )}
      </Field>
      <ErrorText>{error}</ErrorText>
      {result && (
        <div className="space-y-2" role="status">
          <p className="text-sm">
            {t('import.found', { n: count })}
            {result.skipped.length > 0 && ` · ${t('import.skipped', { n: result.skipped.length })}`}
          </p>
          {result.skipped.length > 0 && (
            <ul className="max-h-24 overflow-auto text-xs text-muted">
              {result.skipped.slice(0, 20).map((s, i) => (
                <li key={i}>
                  {s.title || '—'}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" disabled={busy || count === 0} onClick={doImport}>
            {busy ? t('common.working') : t('import.run', { n: count })}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">{t('import.warning')}</p>
    </>
  );
}
