import {
  KeyRound,
  Lock,
  LockKeyhole,
  Settings as Cog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Logo, Toaster } from '../../components/ui';
import { useActivityAndTheme, useSettings, useStatus, useVaultData } from '../../lib/hooks';
import { useNav, type Tab } from '../../lib/nav';
import { lock } from '../../lib/vault';
import { Reauth, RecoveryKit, Unlock, Welcome } from '../../screens/Auth';
import { SettingsTab } from '../../screens/Settings';
import { Authenticator, Generator } from '../../screens/Tools';
import { VaultTab } from '../../screens/Vault';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'vault', label: 'Vault', icon: LockKeyhole },
  { id: 'authenticator', label: 'Codes', icon: ShieldCheck },
  { id: 'generator', label: 'Generate', icon: KeyRound },
  { id: 'settings', label: 'Settings', icon: Cog },
];

export function App() {
  const status = useStatus();
  const settings = useSettings();
  const { tab, setTab, view } = useNav();
  useActivityAndTheme(settings?.theme);
  const unlocked = !!status?.unlocked;
  const data = useVaultData(unlocked && status.hasAccount);

  let body: React.ReactNode;
  if (!status || !settings) {
    body = (
      <div className="grid h-full place-items-center">
        <div className="float-slow">
          <Logo size={44} />
        </div>
      </div>
    );
  } else if (!status.hasAccount) body = <Welcome />;
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
    // Detail / editor screens bring their own header and use the full height.
    const inDetail = tab === 'vault' && view.name !== 'list';
    body = (
      <div className="relative flex h-full flex-col">
        {!inDetail && (
          <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
            <Logo size={30} />
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="text-gradient text-[17px] font-extrabold tracking-tight">Voult</h1>
              <p className="truncate text-[11px] text-muted">{status.email}</p>
            </div>
            <button
              aria-label="Lock vault"
              title="Lock"
              className="glass grid size-9 place-items-center rounded-xl text-muted transition-all hover:text-fg active:scale-90"
              onClick={() => void lock()}
            >
              <Lock size={16} />
            </button>
          </header>
        )}
        <div className="flex min-h-0 flex-1 flex-col pb-[76px]">
          {tab === 'vault' &&
            (data ? (
              <VaultTab items={data.items} vaults={data.vaults} />
            ) : (
              <div className="p-6 text-muted">Decrypting…</div>
            ))}
          {tab === 'authenticator' && (
            <Authenticator items={data?.items ?? []} vaultId={data?.vaults[0]?.id} />
          )}
          {tab === 'generator' && <Generator />}
          {tab === 'settings' && <SettingsTab settings={settings} status={status} />}
        </div>
        <nav
          aria-label="Main"
          className="glass-strong absolute inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(id)}
                className={`relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-all ${
                  active ? 'brand-bg brand-glow' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.25 : 1.9} />
                {label}
              </button>
            );
          })}
        </nav>
        <Toaster />
      </div>
    );
  }

  return <div className="popup-frame relative mx-auto overflow-hidden">{body}</div>;
}
