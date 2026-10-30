import { describe, expect, it } from 'vitest';
import { createAccount, newKey } from '../crypto/keys';
import { createVault, encryptItem, newId } from '../vault/ops';
import { itemSchema, type Item } from '../vault/schemas';
import { parseCsv, parseCsvRecords, toCsv } from './csv';
import {
  importBitwardenJson,
  importBrowserCsv,
  importFrom,
  importOnePasswordCsv,
  importProtonJson,
} from './importers';
import {
  exportCsv,
  exportJson,
  openSnapshot,
  parseSnapshot,
  serializeSnapshot,
  snapshotChecksum,
  type Snapshot,
} from './snapshot';

const FAST = { m: 64, t: 1, p: 1 };

describe('csv', () => {
  it('parses quotes, escaped quotes, newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x,1","he said ""hi""\nbye"\r\n\r\nlast,');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"\nbye'],
      ['last', ''],
    ]);
  });
  it('builds records and round-trips with toCsv', () => {
    expect(parseCsvRecords('Name,URL\nfoo,bar')).toEqual([{ name: 'foo', url: 'bar' }]);
    expect(parseCsvRecords('')).toEqual([]);
    const rows = [
      ['a', 'b,c'],
      ['d"e', 'f\ng'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsvRecords('a,b\n1')).toEqual([{ a: '1', b: '' }]);
  });
});

describe('importers', () => {
  it('Chrome CSV', () => {
    const r = importBrowserCsv(
      'name,url,username,password,note\n,https://a.com/x,me,pw,hi\nB,,u,p,',
    );
    const [a, b] = r.vaults[0]!.items;
    expect(a).toMatchObject({ type: 'login', title: 'a.com', username: 'me', notes: 'hi' });
    expect(b).toMatchObject({ title: 'B' });
  });
  it('Chrome CSV with unparsable url falls back to the raw url as title', () => {
    const r = importBrowserCsv('name,url,username,password\n,not a url,u,p');
    expect(r.vaults[0]!.items[0]!.title).toBe('not a url');
  });
  it('Firefox CSV with timestamps', () => {
    const r = importBrowserCsv(
      'url,username,password,guid,timeCreated,timePasswordChanged\nhttps://f.com,u,p,{g},1600000000000,1700000000000',
    );
    expect(r.vaults[0]!.items[0]).toMatchObject({
      createdAt: 1600000000000,
      updatedAt: 1700000000000,
    });
  });
  it('1Password CSV (login, note, totp)', () => {
    const r = importOnePasswordCsv(
      'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\n' +
        'Site,https://s.com,me,pw,otpauth://totp/x?secret=ABCD,1,0,,n\n' +
        'My note,,,,,0,0,,secret text',
    );
    const [login, note] = r.vaults[0]!.items;
    expect(login).toMatchObject({ type: 'login', favorite: true });
    expect(login!.type === 'login' && login!.totp?.secret).toBe('ABCD');
    expect(note).toMatchObject({ type: 'note', notes: 'secret text' });
  });
  it('Bitwarden JSON: login, note, card, identity, unsupported, bare totp secret', () => {
    const r = importBitwardenJson(
      JSON.stringify({
        items: [
          {
            type: 1,
            name: 'L',
            notes: 'n',
            favorite: true,
            creationDate: '2024-01-01T00:00:00Z',
            revisionDate: '2024-02-01T00:00:00Z',
            login: {
              username: 'u',
              password: 'p',
              totp: 'JBSWY3DPEHPK3PXP',
              uris: [{ uri: 'https://l.com' }, { uri: null }],
            },
            fields: [
              { name: 'a', value: 'b', type: 0 },
              { name: 'h', value: null, type: 1 },
            ],
          },
          { type: 2, name: 'N', notes: 'text' },
          {
            type: 3,
            name: 'C',
            card: {
              cardholderName: 'Me',
              number: '4111',
              expMonth: '1',
              expYear: '30',
              code: '123',
            },
          },
          { type: 3, name: 'C2' },
          {
            type: 4,
            name: 'I',
            identity: {
              firstName: 'A',
              lastName: 'B',
              email: 'e',
              phone: 'p',
              address1: 'x',
              city: 'y',
            },
          },
          { type: 4, name: 'I2' },
          { type: 9, name: 'weird' },
          { type: 1, name: 'bad totp', login: { totp: '%%%' } },
        ],
      }),
    );
    const items = r.vaults[0]!.items;
    expect(items).toHaveLength(7);
    expect(items[0]).toMatchObject({
      favorite: true,
      createdAt: Date.parse('2024-01-01T00:00:00Z'),
    });
    expect(items[0]!.type === 'login' && items[0]!.totp?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(items[0]!.type === 'login' && items[0]!.customFields.map((f) => f.type)).toEqual([
      'text',
      'hidden',
    ]);
    expect(items[2]).toMatchObject({ type: 'card', expiry: '1/30', cvv: '123' });
    expect(items[4]).toMatchObject({ type: 'identity', fullName: 'A B', address: 'x, y' });
    expect(items[6]!.type === 'login' && items[6]!.totp).toBeUndefined();
    expect(r.skipped).toEqual([{ title: 'weird', reason: 'unsupported Bitwarden item type 9' }]);
  });
  it('Bitwarden: encrypted export is rejected', () => {
    expect(() => importBitwardenJson('{"encrypted":true}')).toThrow('Encrypted');
    expect(importBitwardenJson('{}').vaults[0]!.items).toEqual([]);
  });
  it('Proton Pass JSON', () => {
    const r = importProtonJson(
      JSON.stringify({
        vaults: {
          v1: {
            name: 'Personal',
            items: [
              {
                data: {
                  type: 'login',
                  metadata: { name: 'L', note: 'n' },
                  content: {
                    itemUsername: 'u',
                    itemEmail: 'e',
                    password: 'p',
                    urls: ['https://p.com'],
                    totpUri: 'otpauth://totp/x?secret=ABC',
                  },
                },
                pinned: true,
                createTime: 1700000000,
                modifyTime: 1700000100,
              },
              { data: { type: 'note', metadata: { name: 'N', note: 'body' } } },
              {
                data: {
                  type: 'creditCard',
                  metadata: { name: 'C' },
                  content: {
                    number: '4111',
                    cardholderName: 'Me',
                    verificationNumber: '1',
                    expirationDate: '2030-01',
                  },
                },
              },
              {
                data: {
                  type: 'identity',
                  metadata: { name: 'I' },
                  content: { fullName: 'Me', email: 'e', phoneNumber: 'p' },
                },
              },
              { data: { type: 'alias', metadata: { name: 'A' } } },
            ],
          },
          v2: {},
        },
      }),
    );
    expect(r.vaults.map((v) => v.name)).toEqual(['Personal', 'Imported']);
    const items = r.vaults[0]!.items;
    expect(items[0]).toMatchObject({
      pinned: true,
      createdAt: 1700000000000,
      updatedAt: 1700000100000,
    });
    expect(items[2]).toMatchObject({ type: 'card', number: '4111' });
    expect(items[3]).toMatchObject({ type: 'identity', phone: 'p' });
    expect(r.skipped).toHaveLength(1);
    expect(() => importProtonJson('{"encrypted":true}')).toThrow('Encrypted');
    expect(importProtonJson('{}').vaults).toEqual([]);
  });
  it('importFrom dispatches', () => {
    expect(importFrom('chrome', 'name,url\nA,b').vaults[0]!.items).toHaveLength(1);
    expect(importFrom('firefox', 'url\nhttps://x.com').vaults[0]!.items).toHaveLength(1);
    expect(importFrom('onepassword', 'Title\nx').vaults[0]!.items).toHaveLength(1);
    expect(importFrom('bitwarden', '{"items":[]}').vaults).toHaveLength(1);
    expect(importFrom('proton', '{}').vaults).toEqual([]);
  });
});

async function buildSnapshot() {
  const acc = await createAccount('master pw', FAST);
  const { record, vaultKey } = createVault(acc.accountKey, { name: 'Personal' }, newId());
  const mk = (over: Record<string, unknown>): Item =>
    itemSchema.parse({ title: 't', createdAt: 1, updatedAt: 1, ...over });
  const items: [Item, number, number | null][] = [
    [
      mk({
        type: 'login',
        title: 'Site',
        username: 'me',
        password: 'pw',
        urls: [{ url: 'https://s.com' }],
        totp: { secret: 'ABCD' },
        passkeys: [
          {
            credentialId: 'c',
            rpId: 'r',
            userHandle: 'u',
            privateKey: 'k',
            signCount: 1,
            createdAt: 1,
          },
        ],
      }),
      2,
      null,
    ],
    [mk({ type: 'totp', totp: { secret: 'EFGH' } }), 1, null],
    [mk({ type: 'note', title: 'trashed' }), 1, 99],
  ];
  const snapshot: Snapshot = {
    format: 'voult-snapshot',
    version: 1,
    createdAt: 5,
    kdfParams: acc.material.kdfParams,
    salt: acc.material.salt,
    wrappedAccountKey: acc.material.wrappedAccountKey,
    wrappedRecoveryKey: acc.material.wrappedRecoveryKey,
    vaults: [{ ...record, deletedAt: null }],
    items: items.map(([item, rev, deletedAt]) => {
      const id = newId();
      return {
        id,
        vaultId: record.id,
        type: item.type,
        rev,
        updatedAt: 1,
        deletedAt,
        ...encryptItem(vaultKey, id, rev, item),
      };
    }),
  };
  return { snapshot, acc };
}

describe('snapshot', () => {
  it('round-trips and restores with the master password alone', async () => {
    const { snapshot } = await buildSnapshot();
    const parsed = parseSnapshot(serializeSnapshot(snapshot));
    expect(snapshotChecksum(parsed)).toBe(snapshotChecksum(snapshot));
    const opened = await openSnapshot(parsed, { masterPassword: 'master pw' });
    expect(opened.counts).toEqual({ items: 3, totp: 2, passkeys: 1 });
    expect(opened.vaults[0]!.meta.name).toBe('Personal');
  });
  it('restores with the recovery secret and rejects wrong credentials', async () => {
    const { snapshot, acc } = await buildSnapshot();
    expect(
      (await openSnapshot(snapshot, { recoverySecret: acc.recoverySecret })).counts.items,
    ).toBe(3);
    await expect(openSnapshot(snapshot, { masterPassword: 'nope' })).rejects.toThrow();
    await expect(openSnapshot(snapshot, { recoverySecret: 'AAAA-AAAA' })).rejects.toThrow();
  });
  it('checksum is order independent and detects change', async () => {
    const { snapshot } = await buildSnapshot();
    const shuffled = { ...snapshot, items: [...snapshot.items].reverse() };
    expect(snapshotChecksum(shuffled)).toBe(snapshotChecksum(snapshot));
    const tampered = { ...snapshot, items: snapshot.items.map((i) => ({ ...i, rev: i.rev + 1 })) };
    expect(snapshotChecksum(tampered)).not.toBe(snapshotChecksum(snapshot));
  });
  it('rejects malformed snapshots', () => {
    expect(() => parseSnapshot('{"format":"x"}')).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ format: 'voult-snapshot', version: 2 }))).toThrow();
  });
  it('item records bound to the wrong vault key fail to open', async () => {
    const { snapshot } = await buildSnapshot();
    const bad = {
      ...snapshot,
      vaults: [
        {
          ...snapshot.vaults[0]!,
          wrappedVaultKey: createVault(newKey(), { name: 'x' }).record.wrappedVaultKey,
        },
      ],
    };
    await expect(openSnapshot(bad, { masterPassword: 'master pw' })).rejects.toThrow();
  });
  it('plaintext exports skip trash and non-login rows in CSV', async () => {
    const { snapshot } = await buildSnapshot();
    const opened = await openSnapshot(snapshot, { masterPassword: 'master pw' });
    const json = JSON.parse(exportJson(opened));
    expect(json.vaults[0].items).toHaveLength(2);
    const csv = parseCsv(exportCsv(opened));
    expect(csv).toHaveLength(2);
    expect(csv[1]).toEqual(['Site', 'https://s.com', 'me', 'pw', '', 'ABCD', 'Personal']);
  });
  it('csv export falls back to email and empty url', async () => {
    const acc = await createAccount('p', FAST);
    const { record, vaultKey } = createVault(acc.accountKey, { name: 'V' });
    const item = itemSchema.parse({
      type: 'login',
      title: 'E',
      email: 'e@x.com',
      createdAt: 1,
      updatedAt: 1,
    });
    const snap: Snapshot = {
      format: 'voult-snapshot',
      version: 1,
      createdAt: 1,
      kdfParams: FAST,
      salt: acc.material.salt,
      wrappedAccountKey: acc.material.wrappedAccountKey,
      wrappedRecoveryKey: acc.material.wrappedRecoveryKey,
      vaults: [{ ...record, deletedAt: null }],
      items: [
        {
          id: 'i',
          vaultId: record.id,
          type: 'login',
          rev: 1,
          updatedAt: 1,
          deletedAt: null,
          ...encryptItem(vaultKey, 'i', 1, item),
        },
      ],
    };
    const csv = parseCsv(exportCsv(await openSnapshot(snap, { masterPassword: 'p' })));
    expect(csv[1]).toEqual(['E', '', 'e@x.com', '', '', '', 'V']);
  });
});
