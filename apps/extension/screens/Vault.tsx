import type { Item, ItemType } from '@voult/core';
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Star,
  StickyNote,
  Trash2,
  CreditCard,
  IdCard,
  Globe,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { TotpCode } from '../components/Totp';
import { Button, Empty, IconButton, Input, Select } from '../components/ui';
import { copySecret } from '../lib/clipboard';
import { useNav } from '../lib/nav';
import { hostOf, queryItems, type SortKey, type TypeFilter } from '../lib/search';
import {
  purgeItem,
  restoreItem,
  saveItem,
  trashItem,
  type ItemView,
  type VaultView,
} from '../lib/vault';
import { Editor, typeLabel } from './Editor';

const ICONS: Record<ItemType, typeof Globe> = {
  login: Globe,
  note: StickyNote,
  card: CreditCard,
  identity: IdCard,
  totp: ShieldCheck,
};

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
  const Icon = ICONS[v.item.type];
  const i = v.item;
  return (
    <li className="flex items-center gap-1 border-b border-border/60 pr-2">
      <button
        type="button"
        data-testid="item-row"
        onClick={() => open({ name: 'detail', id: v.id })}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-muted">
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 truncate font-medium">
            {i.title || 'Untitled'}
            {i.favorite && (
              <Star size={12} className="fill-current text-primary" aria-label="Favourite" />
            )}
            {v.dirty && <span className="size-1.5 rounded-full bg-muted" title="Not synced yet" />}
          </span>
          <span className="block truncate text-xs text-muted">{subtitle(i)}</span>
        </span>
      </button>
      {i.type === 'login' && i.username && (
        <IconButton
          label={`Copy username for ${i.title}`}
          onClick={() => void copySecret(i.username)}
        >
          <Copy size={14} />
        </IconButton>
      )}
      {i.type === 'login' && i.password && (
        <IconButton
          label={`Copy password for ${i.title}`}
          onClick={() => void copySecret(i.password)}
        >
          <KeyRound size={14} />
        </IconButton>
      )}
    </li>
  );
}

function List({ items, vaults }: { items: ItemView[]; vaults: VaultView[] }) {
  const { query, patchQuery, open } = useNav();
  const [menu, setMenu] = useState(false);
  const rows = useMemo(() => queryItems(items, query), [items, query]);
  const filtering = query.text || query.type !== 'all' || query.vaultId !== 'all';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex gap-2">
          <Input
            type="search"
            aria-label="Search vault"
            placeholder="Search vault"
            value={query.text}
            onChange={(e) => patchQuery({ text: e.target.value })}
          />
          <div className="relative">
            <Button aria-label="Add item" onClick={() => setMenu(!menu)} className="w-9 px-0">
              <Plus size={18} />
            </Button>
            {menu && (
              <ul
                role="menu"
                className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-border bg-bg p-1 shadow-lg"
              >
                {(['login', 'note', 'card', 'identity', 'totp'] as ItemType[]).map((t) => (
                  <li key={t}>
                    <button
                      role="menuitem"
                      className="w-full rounded px-2 py-1.5 text-left hover:bg-surface"
                      onClick={() => {
                        setMenu(false);
                        open({ name: 'new', type: t });
                      }}
                    >
                      {typeLabel(t)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Select
            aria-label="Filter by type"
            value={query.type}
            onChange={(e) => patchQuery({ type: e.target.value as TypeFilter })}
            className="min-w-0 flex-1"
          >
            <option value="all">All types</option>
            {(['login', 'note', 'card', 'identity', 'totp'] as ItemType[]).map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </Select>
          {vaults.length > 1 && (
            <Select
              aria-label="Filter by vault"
              value={query.vaultId}
              onChange={(e) => patchQuery({ vaultId: e.target.value })}
              className="min-w-0 flex-1"
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
            className="min-w-0 flex-1"
          >
            <option value="title">Name</option>
            <option value="updated">Recently edited</option>
            <option value="created">Recently added</option>
          </Select>
        </div>
        <div className="flex gap-1 text-xs">
          <button
            className={`rounded-full px-3 py-1 ${!query.trash ? 'bg-primary text-primary-fg' : 'bg-surface'}`}
            onClick={() => patchQuery({ trash: false })}
          >
            Items
          </button>
          <button
            className={`rounded-full px-3 py-1 ${query.trash ? 'bg-primary text-primary-fg' : 'bg-surface'}`}
            onClick={() => patchQuery({ trash: true })}
          >
            Trash
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        query.trash ? (
          <Empty title="Trash is empty" body="Deleted items stay here for 30 days." />
        ) : filtering ? (
          <Empty title="No matches" body="Try a different search or filter." />
        ) : (
          <Empty title="Your vault is empty" body="Add your first login with the + button." />
        )
      ) : (
        <ul className="flex-1 overflow-auto" aria-label={query.trash ? 'Trash' : 'Items'}>
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
    <div className="flex items-center gap-1 border-b border-border/60 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{label}</div>
        {children ?? (
          <div
            className={`truncate ${mono || secret ? 'font-mono' : ''}`}
            data-testid={`field-${label.toLowerCase()}`}
          >
            {secret && !shown ? '••••••••••••' : value}
          </div>
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
        <IconButton label={`Copy ${label}`} onClick={() => void copySecret(value)}>
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

  return (
    <div className="fade-in flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <IconButton label="Back" onClick={back}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium" data-testid="detail-title">
            {i.title || 'Untitled'}
          </h2>
          <p className="text-xs text-muted">
            {typeLabel(i.type)}
            {v.dirty ? ' · not synced yet' : ''}
          </p>
        </div>
        {!trashed && (
          <IconButton
            label={i.favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => void saveItem(v.vaultId, { ...i, favorite: !i.favorite }, v.id)}
          >
            <Star size={18} className={i.favorite ? 'fill-current text-primary' : ''} />
          </IconButton>
        )}
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">
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
                  className="flex items-center gap-1 truncate text-primary underline"
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
        {i.notes && (
          <div className="py-2">
            <div className="text-xs text-muted">Notes</div>
            <p className="whitespace-pre-wrap" data-testid="field-notes">
              {i.notes}
            </p>
          </div>
        )}
        {i.type === 'login' && i.passkeys.length > 0 && (
          <section className="py-2" aria-label="Passkeys">
            <div className="text-xs text-muted">Passkeys</div>
            <ul>
              {i.passkeys.map((k) => (
                <li key={k.credentialId} className="flex items-center gap-2 py-1">
                  <KeyRound size={14} className="text-muted" />
                  <span className="flex-1 truncate">
                    {k.rpName || k.rpId}
                    {k.userName ? ` · ${k.userName}` : ''}
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {i.type === 'login' && i.passwordHistory.length > 0 && (
          <details className="py-2">
            <summary className="cursor-pointer text-xs text-muted">
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
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        {trashed ? (
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void restoreItem(v).then(back)}
            >
              <RotateCcw size={14} /> Restore
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
  if (view.name === 'new') return <Editor type={view.type} vaults={vaults} />;
  if (view.name === 'detail' || view.name === 'edit') {
    const v = items.find((x) => x.id === view.id);
    if (!v) return <List items={items} vaults={vaults} />;
    return view.name === 'edit' ? (
      <Editor type={v.item.type} existing={v} vaults={vaults} />
    ) : (
      <Detail v={v} />
    );
  }
  return <List items={items} vaults={vaults} />;
}
