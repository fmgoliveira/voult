import {
  hostOf,
  matchLogin,
  queryItems,
  type Item,
  type ItemType,
  type SortKey,
  type TypeFilter,
} from '@voult/core';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  Fingerprint,
  EyeOff,
  KeyRound,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { TotpCode } from '../components/Totp';
import {
  Button,
  Card,
  Empty,
  IconButton,
  ItemAvatar,
  Pills,
  SearchInput,
  Select,
  TypeTile,
  typeIcon,
} from '../components/ui';
import { copySecret } from '../lib/clipboard';
import { useNav } from '../lib/nav';
import { useActiveSite, useSiteFilter } from '../lib/site';
import {
  purgeItem,
  restoreItem,
  saveItem,
  saveLoginEdit,
  trashItem,
  type ItemView,
  type VaultView,
} from '../lib/vault';
import { Editor, typeLabel } from './Editor';

const TYPES: ItemType[] = ['login', 'note', 'card', 'identity', 'totp'];

function subtitle(i: Item): string {
  switch (i.type) {
    case 'login':
      return i.username || i.email || (i.urls[0] ? hostOf(i.urls[0].url) : '');
    case 'card':
      return i.number ? `•••• ${i.number.slice(-4)}` : i.holder;
    case 'identity':
      return i.fullName || i.email;
    case 'totp':
      return i.totp.issuer || i.totp.account;
    default:
      return '';
  }
}

function Row({ v }: { v: ItemView }) {
  const open = useNav((s) => s.open);
  const i = v.item;
  return (
    <li className="glass group flex items-center gap-1 rounded-2xl pr-1.5 transition-all duration-150 hover:-translate-y-px hover:bg-surface-strong">
      <button
        type="button"
        data-testid="item-row"
        onClick={() => open({ name: 'detail', id: v.id })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2.5 text-left"
      >
        <ItemAvatar type={i.type} title={i.title} urls={i.type === 'login' ? i.urls : undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
            <span className="truncate">{i.title || 'Untitled'}</span>
            {i.favorite && (
              <Star
                size={12}
                className="shrink-0 fill-amber-400 text-amber-400"
                aria-label="Favourite"
              />
            )}
            {v.dirty && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                title="Not synced yet"
                aria-label="Not synced yet"
              />
            )}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="truncate">{subtitle(i)}</span>
            {i.type === 'login' && i.passkeys.length > 0 && (
              <span
                title="Has a passkey"
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary"
              >
                <Fingerprint size={10} /> Passkey
              </span>
            )}
          </span>
        </span>
      </button>
      <span className="flex opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {i.type === 'login' && i.username && (
          <IconButton
            label={`Copy username for ${i.title}`}
            onClick={() => void copySecret(i.username, 'Username copied')}
          >
            <User size={15} />
          </IconButton>
        )}
        {i.type === 'login' && i.password && (
          <IconButton
            label={`Copy password for ${i.title}`}
            onClick={() => void copySecret(i.password, 'Password copied')}
          >
            <KeyRound size={15} />
          </IconButton>
        )}
      </span>
    </li>
  );
}

function List({ items, vaults }: { items: ItemView[]; vaults: VaultView[] }) {
  const { query, patchQuery, open } = useNav();
  const [menu, setMenu] = useState(false);
  const site = useActiveSite();
  const { dismissed, dismiss } = useSiteFilter();
  const siteItems = useMemo(
    () => (site ? items.filter((v) => v.item.type === 'login' && matchLogin(v.item, site)) : []),
    [items, site],
  );
  // On a site we have logins for, start with just those; the chip removes the filter.
  // Typing a search means looking beyond this site, so the filter steps aside until it is cleared.
  const siteOn = siteItems.length > 0 && !dismissed && !query.trash && !query.text;
  const rows = useMemo(
    () => queryItems(siteOn ? siteItems : items, query),
    [items, siteItems, siteOn, query],
  );
  const filtering = query.text || query.type !== 'all' || query.vaultId !== 'all' || siteOn;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 px-4 pb-2">
        <div className="flex gap-2">
          <SearchInput
            aria-label="Search vault"
            autoFocus
            placeholder="Search your vault"
            value={query.text}
            onChange={(e) => patchQuery({ text: e.target.value })}
          />
          <div className="relative">
            <Button
              aria-label="Add item"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
              className="size-10 px-0"
            >
              <Plus
                size={20}
                strokeWidth={2.5}
                className={`transition-transform ${menu ? 'rotate-45' : ''}`}
              />
            </Button>
            {menu && (
              <ul
                role="menu"
                className="glass-strong pop-in absolute right-0 z-30 mt-2 w-48 rounded-2xl p-1.5"
              >
                {TYPES.map((t) => (
                  <li key={t}>
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm font-medium hover:bg-surface"
                      onClick={() => {
                        setMenu(false);
                        open({ name: 'new', type: t });
                      }}
                    >
                      <TypeTile type={t} size={28} />
                      {typeLabel(t)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {siteOn && site && (
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 py-1 pr-1 pl-3 text-xs font-semibold text-primary">
            <span className="min-w-0 flex-1 truncate" data-testid="site-filter">
              Logins for {hostOf(site)}
            </span>
            <button
              type="button"
              aria-label="Show all items"
              onClick={dismiss}
              className="grid size-6 shrink-0 place-items-center rounded-lg hover:bg-primary/15"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="group"
          aria-label="Filter by type"
        >
          <button
            onClick={() => patchQuery({ type: 'all' })}
            aria-pressed={query.type === 'all'}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              query.type === 'all' ? 'brand-bg brand-glow' : 'glass text-muted hover:text-fg'
            }`}
          >
            All
          </button>
          {TYPES.map((t) => {
            const Icon = typeIcon(t);
            const on = query.type === t;
            return (
              <button
                key={t}
                aria-pressed={on}
                aria-label={`Show ${typeLabel(t)}`}
                title={typeLabel(t)}
                onClick={() => patchQuery({ type: on ? 'all' : (t as TypeFilter) })}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${
                  on ? 'brand-bg brand-glow' : 'glass text-muted hover:text-fg'
                }`}
              >
                <Icon size={13} />
                {on && typeLabel(t)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Pills
            label="View"
            value={query.trash ? 'trash' : 'items'}
            onChange={(v) => patchQuery({ trash: v === 'trash' })}
            options={[
              { value: 'items', label: 'Items' },
              { value: 'trash', label: 'Trash' },
            ]}
          />
          <div className="flex-1" />
          {vaults.length > 1 && (
            <Select
              aria-label="Filter by vault"
              value={query.vaultId}
              onChange={(e) => patchQuery({ vaultId: e.target.value })}
              className="h-8 text-xs"
            >
              <option value="all">All vaults</option>
              {vaults.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.meta.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            aria-label="Sort"
            value={query.sort}
            onChange={(e) => patchQuery({ sort: e.target.value as SortKey })}
            className="h-8 text-xs"
          >
            <option value="title">Name</option>
            <option value="updated">Recently edited</option>
            <option value="created">Recently added</option>
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        query.trash ? (
          <Empty title="Trash is empty" body="Deleted items stay here for 30 days." icon={Trash2} />
        ) : filtering ? (
          <Empty title="No matches" body="Try a different search or filter." />
        ) : (
          <Empty title="Your vault is empty" body="Add your first login with the + button." />
        )
      ) : (
        <ul
          className="flex-1 space-y-2 overflow-auto px-4 pt-1 pb-3"
          aria-label={query.trash ? 'Trash' : 'Items'}
        >
          {rows.map((v) => (
            <Row key={v.id} v={v} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  secret,
  mono,
  children,
}: {
  label: string;
  value: string;
  secret?: boolean;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  if (!value && !children) return null;
  return (
    <div className="flex items-center gap-1 border-b border-border px-3.5 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold tracking-wide text-muted">{label}</div>
        {children ?? (
          <button
            type="button"
            title={`Click to copy ${label.toLowerCase()}`}
            onClick={() => void copySecret(value, `${label} copied`)}
            className="-mx-1.5 -my-0.5 block w-[calc(100%+12px)] cursor-copy rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-primary/8"
          >
            <span
              className={`block truncate text-sm ${mono || secret ? 'font-mono' : ''}`}
              data-testid={`field-${label.toLowerCase()}`}
            >
              {secret && !shown ? '••••••••••••' : value}
            </span>
          </button>
        )}
      </div>
      {secret && (
        <IconButton
          label={shown ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      )}
      {value && (
        <IconButton
          label={`Copy ${label}`}
          onClick={() => void copySecret(value, `${label} copied`)}
        >
          <Copy size={16} />
        </IconButton>
      )}
    </div>
  );
}

function Detail({ v }: { v: ItemView }) {
  const { back, open } = useNav();
  const i = v.item;
  const trashed = v.deletedAt !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <div className="fade-in flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-3 pb-1">
        <IconButton label="Back" onClick={back} className="glass">
          <ArrowLeft size={18} />
        </IconButton>
        <div className="flex-1" />
        {!trashed && (
          <IconButton
            label={i.favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => void saveItem(v.vaultId, { ...i, favorite: !i.favorite }, v.id)}
            className="glass"
          >
            <Star size={18} className={i.favorite ? 'fill-amber-400 text-amber-400' : ''} />
          </IconButton>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-4 pb-3">
        <div className="flex flex-col items-center gap-1.5 pt-1 pb-1 text-center">
          <ItemAvatar
            type={i.type}
            title={i.title}
            size={56}
            urls={i.type === 'login' ? i.urls : undefined}
          />
          <h2
            className="max-w-full truncate text-lg font-extrabold tracking-tight"
            data-testid="detail-title"
          >
            {i.title || 'Untitled'}
          </h2>
          <p className="text-xs text-muted">
            {typeLabel(i.type)}
            {v.dirty ? ' · not synced yet' : ''}
          </p>
        </div>

        <Card className="overflow-hidden">
          {i.type === 'login' && (
            <>
              <Line label="Username" value={i.username} />
              <Line label="Email" value={i.email} />
              <Line label="Password" value={i.password} secret />
              {i.totp && (
                <Line label="One-time code" value="">
                  <TotpCode entry={i.totp} showNext />
                </Line>
              )}
              {i.urls.map((u, n) => (
                <Line key={n} label={n === 0 ? 'Website' : `Website ${n + 1}`} value={u.url}>
                  <a
                    className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:underline"
                    href={u.url.includes('://') ? u.url : `https://${u.url}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {u.url} <ExternalLink size={12} />
                  </a>
                </Line>
              ))}
              {i.customFields.map((f, n) =>
                f.type === 'totp' ? (
                  <Line key={n} label={f.name} value="">
                    <TotpCode entry={f.value} compact />
                  </Line>
                ) : (
                  <Line key={n} label={f.name} value={f.value} secret={f.type === 'hidden'} />
                ),
              )}
            </>
          )}
          {i.type === 'card' && (
            <>
              <Line label="Cardholder" value={i.holder} />
              <Line label="Number" value={i.number} mono />
              <Line label="Expiry" value={i.expiry} />
              <Line label="CVV" value={i.cvv} secret />
              <Line label="PIN" value={i.pin} secret />
            </>
          )}
          {i.type === 'identity' && (
            <>
              <Line label="Full name" value={i.fullName} />
              <Line label="Email" value={i.email} />
              <Line label="Phone" value={i.phone} />
              <Line label="Address" value={i.address} />
              <Line label="Birthday" value={i.birthday} />
            </>
          )}
          {i.type === 'totp' && (
            <>
              <Line label="Issuer" value={i.totp.issuer} />
              <Line label="Account" value={i.totp.account} />
              <Line label="One-time code" value="">
                <TotpCode entry={i.totp} showNext />
              </Line>
            </>
          )}
        </Card>

        {i.notes && (
          <Card className="p-3.5">
            <div className="text-[11px] font-semibold tracking-wide text-muted">Notes</div>
            <p className="mt-1 text-sm whitespace-pre-wrap" data-testid="field-notes">
              {i.notes}
            </p>
          </Card>
        )}

        {i.type === 'login' && i.passkeys.length > 0 && (
          <Card className="p-3.5">
            <section aria-label="Passkeys">
              <div className="text-[11px] font-semibold tracking-wide text-muted">Passkeys</div>
              <ul className="mt-1 space-y-1">
                {i.passkeys.map((k) => (
                  <li key={k.credentialId} className="flex items-center gap-2 text-sm">
                    <span className="brand-bg grid size-6 place-items-center rounded-lg">
                      <KeyRound size={12} />
                    </span>
                    <span className="flex-1 truncate">
                      {k.rpName || k.rpId}
                      {k.userName ? ` · ${k.userName}` : ''}
                    </span>
                    {removing === k.credentialId ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => {
                            setRemoving(null);
                            void saveLoginEdit(v, {
                              passkeys: i.passkeys.filter((p) => p.credentialId !== k.credentialId),
                            });
                          }}
                        >
                          Remove
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setRemoving(null)}
                        >
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-muted">
                          {new Date(k.createdAt).toLocaleDateString()}
                        </span>
                        <IconButton
                          label={`Remove passkey for ${k.rpName || k.rpId}`}
                          className="size-7 text-danger"
                          onClick={() => setRemoving(k.credentialId)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </Card>
        )}

        {i.type === 'login' && i.passwordHistory.length > 0 && (
          <Card className="overflow-hidden">
            <details>
              <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-semibold text-muted">
                Password history ({i.passwordHistory.length})
              </summary>
              <ul>
                {i.passwordHistory.map((h, n) => (
                  <Line
                    key={n}
                    label={new Date(h.changedAt).toLocaleString()}
                    value={h.password}
                    secret
                  />
                ))}
              </ul>
            </details>
          </Card>
        )}
      </div>

      <div className="flex gap-2 px-4 pb-2">
        {trashed ? (
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void restoreItem(v).then(back)}
            >
              <RotateCcw size={15} /> Restore
            </Button>
            {confirmDelete ? (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void purgeItem(v).then(back)}
              >
                Confirm delete forever
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="flex-1 text-danger"
                onClick={() => setConfirmDelete(true)}
              >
                Delete forever
              </Button>
            )}
          </>
        ) : (
          <>
            <Button className="flex-1" onClick={() => open({ name: 'edit', id: v.id })}>
              Edit
            </Button>
            <Button
              variant="secondary"
              aria-label="Move to trash"
              onClick={() => void trashItem(v).then(back)}
            >
              <Trash2 size={16} /> Trash
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function VaultTab({ items, vaults }: { items: ItemView[]; vaults: VaultView[] }) {
  const view = useNav((s) => s.view);
  if (view.name === 'new') return <Editor type={view.type} vaults={vaults} items={items} />;
  if (view.name === 'detail' || view.name === 'edit') {
    const v = items.find((x) => x.id === view.id);
    if (!v) return <List items={items} vaults={vaults} />;
    return view.name === 'edit' ? (
      <Editor type={v.item.type} existing={v} vaults={vaults} items={items} />
    ) : (
      <Detail v={v} />
    );
  }
  return <List items={items} vaults={vaults} />;
}
