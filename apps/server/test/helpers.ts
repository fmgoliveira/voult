import { createAccount, createVault, encryptItem, itemSchema, newId, type Item } from '@voult/core';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';

export const FAST_KDF = { m: 64, t: 1, p: 1 };

export function testServer(env: Record<string, string | undefined> = {}) {
  const cfg = { ...loadConfig({ JWT_SECRET: 'x'.repeat(40), ...env }), serverKdf: FAST_KDF };
  const { sqlite, db } = openDb(':memory:');
  const server = createApp(cfg, db);
  return { ...server, cfg, sqlite };
}
export type TestServer = ReturnType<typeof testServer>;

export interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  userId: string;
}

export class Client {
  session!: Session;
  constructor(
    readonly srv: TestServer,
    readonly email = 'me@example.com',
    readonly password = 'correct horse',
  ) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.srv.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.session ? { authorization: `Bearer ${this.session.accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, res };
  }

  async signup() {
    const acc = await createAccount(this.password, FAST_KDF);
    const r = await this.call('POST', '/auth/signup', {
      email: this.email,
      authKey: acc.material.authKey,
      kdfParams: acc.material.kdfParams,
      salt: acc.material.salt,
      wrappedAccountKey: acc.material.wrappedAccountKey,
      wrappedRecoveryKey: acc.material.wrappedRecoveryKey,
      device: { name: 'test', platform: 'chrome' },
    });
    if (r.status === 201) this.session = r.json;
    return { ...r, acc };
  }

  /** Create a vault record on the server and return its key. */
  async newVault(accountKey: Uint8Array) {
    const { record, vaultKey } = createVault(accountKey, { name: 'Personal' }, newId());
    const r = await this.call(
      'PUT',
      `/vaults/${record.id}`,
      { wrappedVaultKey: record.wrappedVaultKey, encMeta: record.encMeta },
      { 'if-match': '0' },
    );
    return { vaultId: record.id, vaultKey, rev: r.json.rev as number };
  }

  putItem(
    vaultId: string,
    vaultKey: Uint8Array,
    id: string,
    item: Item,
    version: number,
    ifMatch: number,
    deletedAt: number | null = null,
  ) {
    const enc = encryptItem(vaultKey, id, version, item);
    return this.call(
      'PUT',
      `/items/${id}`,
      { vaultId, type: item.type, version, deletedAt, ...enc },
      { 'if-match': String(ifMatch) },
    );
  }
}

export const login = (over: Record<string, unknown> = {}): Item =>
  itemSchema.parse({
    type: 'login',
    title: 'GitHub',
    username: 'octocat',
    password: 'SuperSecretPassword',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });
