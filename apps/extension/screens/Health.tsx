import { analyzeHealth, breachedLogins, type HealthReport, type ItemView } from '@voult/core';
import { useState } from 'react';
import { Button, ErrorText } from '../components/ui';
import { useAsyncAction } from '../lib/hooks';
import { useT } from '../lib/i18n';
import { useNav } from '../lib/nav';

function Group({
  title,
  items,
  extra,
}: {
  title: string;
  items: ItemView[];
  extra?: (v: ItemView) => string;
}) {
  const open = (id: string) => {
    useNav.getState().setTab('vault');
    useNav.getState().open({ name: 'detail', id });
  };
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-bold tracking-wide text-muted uppercase">
        {title} ({items.length})
      </h4>
      <ul className="space-y-0.5">
        {items.slice(0, 20).map((v) => (
          <li key={v.id}>
            <button
              type="button"
              className="w-full truncate rounded-lg px-2 py-1 text-left hover:bg-surface-strong"
              onClick={() => open(v.id)}
            >
              {v.item.title || '—'}
              {extra ? <span className="text-xs text-muted"> · {extra(v)}</span> : null}
            </button>
          </li>
        ))}
        {items.length > 20 && <li className="px-2 text-xs text-muted">+{items.length - 20}</li>}
      </ul>
    </div>
  );
}

/** Settings → Password health: weak / reused / old locally, breaches via HIBP k-anonymity. */
export function HealthPanel({ items }: { items: ItemView[] }) {
  const t = useT();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [breached, setBreached] = useState<{ item: ItemView; count: number }[] | null>(null);
  const { busy, error, run } = useAsyncAction();

  return (
    <>
      <p className="text-xs text-muted">{t('health.intro')}</p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          setReport(analyzeHealth(items));
          setBreached(null);
        }}
      >
        {t('health.scan')}
      </Button>
      {report && (
        <div className="space-y-3" role="status">
          <p className="text-sm font-semibold">
            {t('health.score')}: {report.score}/100
          </p>
          {report.weak.length + report.reused.length + report.old.length === 0 && (
            <p className="text-xs text-muted">{t('health.allGood')}</p>
          )}
          {report.weak.length > 0 && <Group title={t('health.weak')} items={report.weak} />}
          {report.reused.length > 0 && (
            <Group title={t('health.reused')} items={report.reused.flat()} />
          )}
          {report.old.length > 0 && <Group title={t('health.old')} items={report.old} />}

          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => {
              if (!confirm(t('health.breachInfo'))) return;
              void run(
                async () => setBreached(await breachedLogins(items)),
                () => t('health.breachFailed'),
              );
            }}
          >
            {busy ? t('health.checking') : t('health.checkBreaches')}
          </Button>
          <ErrorText>{error}</ErrorText>
          {breached && (
            <>
              {breached.length === 0 ? (
                <p className="text-xs text-muted">{t('health.allGood')}</p>
              ) : (
                <Group
                  title={t('health.breached')}
                  items={breached.map((b) => b.item)}
                  extra={(v) =>
                    t('health.times', { n: breached.find((b) => b.item.id === v.id)!.count })
                  }
                />
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
