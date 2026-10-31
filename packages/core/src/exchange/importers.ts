import { fromBase64Url, toBase64Url } from '../crypto/bytes';
import { parseOtpauthUri } from '../totp/otpauth';
import { itemSchema, type Item, type Passkey } from '../vault/schemas';
import { parseCsvRecords } from './csv';

export type ImportSource = 'chrome' | 'firefox' | 'bitwarden' | 'onepassword' | 'proton';

export interface ImportedVault {
  name: string;
  items: Item[];
}

export interface ImportResult {
  vaults: ImportedVault[];
  /** Entries that could not be converted, with a reason. */
  skipped: { title: string; reason: string }[];
}

const now = () => Date.now();

function safeTotp(uri: string | undefined | null) {
  if (!uri) return undefined;
  try {
    // Bitwarden may export a bare base32 secret instead of a URI.
    return parseOtpauthUri(uri.startsWith('otpauth:') ? uri : `otpauth://totp/x?secret=${uri}`);
  } catch {
    return undefined;
  }
}

function login(p: {
  title: string;
  username?: string;
  email?: string;
  password?: string;
  urls?: string[];
  notes?: string;
  totp?: string | null;
  favorite?: boolean;
  pinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
  customFields?: { name: string; value: string; hidden?: boolean }[];
  passkeys?: Passkey[];
}): Item {
  const t = now();
  return itemSchema.parse({
    type: 'login',
    title: p.title || 'Untitled',
    username: p.username ?? '',
    email: p.email ?? '',
    password: p.password ?? '',
    notes: p.notes ?? '',
    favorite: p.favorite ?? false,
    pinned: p.pinned ?? false,
    urls: (p.urls ?? []).filter(Boolean).map((url) => ({ url })),
    totp: safeTotp(p.totp),
    customFields: (p.customFields ?? []).map((f) => ({
      type: f.hidden ? 'hidden' : 'text',
      name: f.name,
      value: f.value,
    })),
    passkeys: p.passkeys ?? [],
    createdAt: p.createdAt ?? t,
    updatedAt: p.updatedAt ?? p.createdAt ?? t,
  });
}

function note(title: string, notes: string): Item {
  const t = now();
  return itemSchema.parse({
    type: 'note',
    title: title || 'Untitled',
    notes,
    createdAt: t,
    updatedAt: t,
  });
}

/** Chrome (name,url,username,password,note) and Firefox (url,username,password,guid,timeCreated…). */
export function importBrowserCsv(text: string): ImportResult {
  const items = parseCsvRecords(text).map((r) => {
    const url = r.url ?? '';
    let title = r.name ?? '';
    if (!title && url) {
      try {
        title = new URL(url).hostname;
      } catch {
        title = url;
      }
    }
    const created = Number(r.timecreated);
    return login({
      title,
      username: r.username,
      password: r.password,
      urls: [url],
      notes: r.note ?? '',
      createdAt: created > 0 ? created : undefined,
      updatedAt: Number(r.timepasswordchanged) > 0 ? Number(r.timepasswordchanged) : undefined,
    });
  });
  return { vaults: [{ name: 'Imported', items }], skipped: [] };
}

/** 1Password CSV export: Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes. */
export function importOnePasswordCsv(text: string): ImportResult {
  const items: Item[] = [];
  for (const r of parseCsvRecords(text)) {
    if (!r.password && !r.username && !r.url && r.notes) items.push(note(r.title ?? '', r.notes));
    else
      items.push(
        login({
          title: r.title ?? '',
          username: r.username,
          password: r.password,
          urls: [r.url ?? '', r.urls ?? ''],
          notes: r.notes,
          totp: r.otpauth || r.otp,
          favorite: r.favorite === '1' || r.favorite === 'true',
        }),
      );
  }
  return { vaults: [{ name: 'Imported', items }], skipped: [] };
}

interface BitwardenItem {
  type: number;
  name?: string;
  notes?: string | null;
  favorite?: boolean;
  creationDate?: string;
  revisionDate?: string;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[];
    fido2Credentials?: BitwardenFido2[];
  };
  card?: {
    cardholderName?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  };
  identity?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    address1?: string | null;
    city?: string | null;
    country?: string | null;
  };
  fields?: { name?: string; value?: string | null; type?: number }[];
}

interface BitwardenFido2 {
  credentialId?: string;
  keyType?: string;
  keyAlgorithm?: string;
  keyCurve?: string;
  /** PKCS#8 private key, base64url. */
  keyValue?: string;
  rpId?: string;
  rpName?: string;
  userHandle?: string;
  userName?: string;
  counter?: string | number;
  creationDate?: string;
}

/** Raw 32-byte scalar inside a P-256 PKCS#8 / SEC1 private key (`02 01 01 04 20 <32 bytes>`). */
export function p256ScalarFromPkcs8(der: Uint8Array): Uint8Array | null {
  for (let i = 0; i + 5 + 32 <= der.length; i++) {
    if (
      der[i] === 2 &&
      der[i + 1] === 1 &&
      der[i + 2] === 1 &&
      der[i + 3] === 4 &&
      der[i + 4] === 0x20
    ) {
      return der.slice(i + 5, i + 5 + 32);
    }
  }
  return null;
}

/** Bitwarden shows GUID credential ids for passkeys it created; relying parties know the raw bytes. */
function bitwardenCredentialId(id: string): string {
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    const hex = id.replace(/-/g, '');
    return toBase64Url(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
  }
  return id;
}

function bitwardenPasskeys(
  list: BitwardenFido2[] | undefined,
  skipped: ImportResult['skipped'],
  title: string,
): Passkey[] {
  const out: Passkey[] = [];
  for (const k of list ?? []) {
    try {
      if (k.keyAlgorithm && k.keyAlgorithm !== 'ECDSA') throw new Error('algorithm');
      if (k.keyCurve && k.keyCurve !== 'P-256') throw new Error('curve');
      const scalar = p256ScalarFromPkcs8(fromBase64Url(k.keyValue ?? ''));
      if (!scalar || !k.credentialId || !k.rpId || !k.userHandle) throw new Error('fields');
      out.push({
        credentialId: bitwardenCredentialId(k.credentialId),
        rpId: k.rpId,
        rpName: k.rpName ?? '',
        userHandle: k.userHandle,
        userName: k.userName ?? '',
        privateKey: toBase64Url(scalar),
        signCount: Number(k.counter ?? 0) || 0,
        createdAt: (k.creationDate && Date.parse(k.creationDate)) || now(),
      });
    } catch {
      skipped.push({
        title,
        reason: `passkey for ${k.rpId ?? 'unknown site'} could not be converted`,
      });
    }
  }
  return out;
}

export function importBitwardenJson(text: string): ImportResult {
  const data = JSON.parse(text) as { encrypted?: boolean; items?: BitwardenItem[] };
  if (data.encrypted) throw new Error('Encrypted Bitwarden exports are not supported');
  const items: Item[] = [];
  const skipped: ImportResult['skipped'] = [];
  const ts = (s?: string) => (s ? Date.parse(s) || undefined : undefined);
  for (const b of data.items ?? []) {
    const title = b.name ?? '';
    const base = { createdAt: ts(b.creationDate) ?? now(), updatedAt: ts(b.revisionDate) ?? now() };
    const t = now();
    if (b.type === 1) {
      items.push(
        login({
          title,
          username: b.login?.username ?? '',
          password: b.login?.password ?? '',
          urls: (b.login?.uris ?? []).map((u) => u.uri ?? ''),
          notes: b.notes ?? '',
          totp: b.login?.totp,
          passkeys: bitwardenPasskeys(b.login?.fido2Credentials, skipped, title),
          favorite: b.favorite,
          customFields: (b.fields ?? []).map((f) => ({
            name: f.name ?? '',
            value: f.value ?? '',
            hidden: f.type === 1,
          })),
          ...base,
        }),
      );
    } else if (b.type === 2) items.push(note(title, b.notes ?? ''));
    else if (b.type === 3) {
      const c = b.card ?? {};
      items.push(
        itemSchema.parse({
          type: 'card',
          title,
          notes: b.notes ?? '',
          holder: c.cardholderName ?? '',
          number: c.number ?? '',
          expiry: c.expMonth && c.expYear ? `${c.expMonth}/${c.expYear}` : '',
          cvv: c.code ?? '',
          createdAt: t,
          updatedAt: t,
        }),
      );
    } else if (b.type === 4) {
      const i = b.identity ?? {};
      items.push(
        itemSchema.parse({
          type: 'identity',
          title,
          notes: b.notes ?? '',
          fullName: [i.firstName, i.lastName].filter(Boolean).join(' '),
          email: i.email ?? '',
          phone: i.phone ?? '',
          address: [i.address1, i.city, i.country].filter(Boolean).join(', '),
          createdAt: t,
          updatedAt: t,
        }),
      );
    } else skipped.push({ title, reason: `unsupported Bitwarden item type ${b.type}` });
  }
  return { vaults: [{ name: 'Imported', items }], skipped };
}

interface ProtonItem {
  data: {
    type: string;
    metadata?: { name?: string; note?: string };
    content?: {
      itemUsername?: string;
      itemEmail?: string;
      password?: string;
      urls?: string[];
      totpUri?: string;
      number?: string;
      cardholderName?: string;
      verificationNumber?: string;
      expirationDate?: string;
      fullName?: string;
      email?: string;
      phoneNumber?: string;
    };
  };
  pinned?: boolean;
  createTime?: number;
  modifyTime?: number;
}

/** Proton Pass unencrypted JSON export (vaults keyed by id, times in seconds). */
export function importProtonJson(text: string): ImportResult {
  const data = JSON.parse(text) as {
    encrypted?: boolean;
    vaults?: Record<string, { name?: string; items?: ProtonItem[] }>;
  };
  if (data.encrypted) throw new Error('Encrypted Proton Pass exports are not supported');
  const skipped: ImportResult['skipped'] = [];
  const vaults: ImportedVault[] = [];
  for (const v of Object.values(data.vaults ?? {})) {
    const items: Item[] = [];
    for (const p of v.items ?? []) {
      const { type, metadata, content: c = {} } = p.data;
      const title = metadata?.name ?? '';
      const created = p.createTime ? p.createTime * 1000 : undefined;
      const updated = p.modifyTime ? p.modifyTime * 1000 : undefined;
      const t = now();
      if (type === 'login') {
        items.push(
          login({
            title,
            username: c.itemUsername,
            email: c.itemEmail,
            password: c.password,
            urls: c.urls,
            notes: metadata?.note,
            totp: c.totpUri,
            pinned: p.pinned,
            createdAt: created,
            updatedAt: updated,
          }),
        );
      } else if (type === 'note') items.push(note(title, metadata?.note ?? ''));
      else if (type === 'creditCard') {
        items.push(
          itemSchema.parse({
            type: 'card',
            title,
            notes: metadata?.note ?? '',
            holder: c.cardholderName ?? '',
            number: c.number ?? '',
            expiry: c.expirationDate ?? '',
            cvv: c.verificationNumber ?? '',
            createdAt: created ?? t,
            updatedAt: updated ?? t,
          }),
        );
      } else if (type === 'identity') {
        items.push(
          itemSchema.parse({
            type: 'identity',
            title,
            notes: metadata?.note ?? '',
            fullName: c.fullName ?? '',
            email: c.email ?? '',
            phone: c.phoneNumber ?? '',
            createdAt: created ?? t,
            updatedAt: updated ?? t,
          }),
        );
      } else skipped.push({ title, reason: `unsupported Proton Pass item type ${type}` });
    }
    vaults.push({ name: v.name ?? 'Imported', items });
  }
  return { vaults, skipped };
}

export function importFrom(source: ImportSource, text: string): ImportResult {
  switch (source) {
    case 'chrome':
    case 'firefox':
      return importBrowserCsv(text);
    case 'onepassword':
      return importOnePasswordCsv(text);
    case 'bitwarden':
      return importBitwardenJson(text);
    case 'proton':
      return importProtonJson(text);
  }
}
