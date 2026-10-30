import { KeyRound, Lock, Settings as Cog, ShieldCheck, Vault } from 'lucide-react';
import { Logo } from '../../components/ui';
import { useActivityAndTheme, useSettings, useStatus, useVaultData } from '../../lib/hooks';
import { useNav, type Tab } from '../../lib/nav';
import { lock } from '../../lib/vault';
import { Reauth, RecoveryKit, Unlock, Welcome } from '../../screens/Auth';
import { SettingsTab } from '../../screens/Settings';
import { Authenticator, Generator } from '../../screens/Tools';
import { VaultTab } from '../../screens/Vault';

const TABS: { id: Tab; label: string; icon: typeof Vault }[] = [
  { id: 'vault', label: 'Vault', icon: Vault },
  { id: 'authenticator', label: 'Codes', icon: ShieldCheck },
  { id: 'generator', label: 'Generate', icon: KeyRound },
  { id: 'settings', label: 'Settings', icon: Cog },
];

export function App() {
  const status = useStatus();
  const settings = useSettings();
  const { tab, setTab } = useNav();
  useActivityAndTheme(settings?.theme);
  const unlocked = !!status?.unlocked;
  const data = useVaultData(unlocked && status.hasAccount);

  let body: React.ReactNode;
  if (!status || !settings)
    body = <div className="grid h-full place-items-center text-muted">Loading…</div>;
  else if (!status.hasAccount) body = <Welcome />;
  else if (!status.recoveryConfirmed && status.unlocked) {
    body = (
      <RecoveryKit
        secret={status.pendingRecovery}
        email={status.email}
        serverUrl={status.serverUrl}
      />
    );
  } else if (!status.signedIn) body = <Reauth email={status.email} />;
  else if (!status.unlocked)
    body = <Unlock email={status.email} pin={status.pin} pinEnabled={settings.pinEnabled} />;
  else {
    body = (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Logo size={22} />
          <span className="flex-1 font-semibold">Voult</span>
          <button
            aria-label="Lock vault"
            title="Lock"
            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-fg"
            onClick={() => void lock()}
          >
            <Lock size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'vault' &&
            (data ? (
              <VaultTab items={data.items} vaults={data.vaults} />
            ) : (
              <div className="p-6 text-muted">Decrypting…</div>
            ))}
          {tab === 'authenticator' && <Authenticator items={data?.items ?? []} />}
          {tab === 'generator' && <Generator />}
          {tab === 'settings' && <SettingsTab settings={settings} status={status} />}
        </div>
        <nav aria-label="Main" className="grid grid-cols-4 border-t border-border">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs ${tab === id ? 'text-primary' : 'text-muted hover:text-fg'}`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return <div className="popup-frame mx-auto overflow-hidden bg-bg">{body}</div>;
}
