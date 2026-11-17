import {
  generateEd25519,
  itemSchema,
  setArgon2Implementation,
  type Item,
  type ParsedSshKey,
} from '@voult/core';
import { createTestClient, FakeServer } from '@voult/core/testkit';
import { argon2id } from 'hash-wasm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fakeDpapi } from '../src/dpapi';
import type { Paths } from '../src/paths';
import { createRuntime, type RuntimeDeps } from '../src/runtime';

export const SERVER_URL = 'https://vault.test';
export const EMAIL = 'me@example.com';
export const PASSWORD = 'correct horse battery';

/** Cheap Argon2 so tests stay fast. Call once per test file. */
export function useCheapArgon2() {
  setArgon2Implementation(async (password, salt) =>
    argon2id({
      password,
      salt,
      memorySize: 64,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary',
    }),
  );
}

export function tempPaths(): Paths {
  const dir = mkdtempSync(path.join(tmpdir(), 'voult-desktop-'));
  return {
    dir,
    sshDir: path.join(dir, 'ssh'),
    store: path.join(dir, 'store.json'),
    session: path.join(dir, 'session.json'),
    config: path.join(dir, 'config.json'),
    runtime: path.join(dir, 'agent.json'),
    usageLog: path.join(dir, 'usage.log'),
  };
}

export const sshKeyItem = (key: ParsedSshKey, over: Record<string, unknown> = {}): Item =>
  itemSchema.parse({
    type: 'sshKey',
    title: 'Deploy',
    keyType: key.keyType,
    privateKey: key.privateKey,
    publicKey: key.publicKey,
    fingerprint: key.fingerprint,
    comment: key.comment,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

export const sshHostItem = (over: Record<string, unknown> = {}): Item =>
  itemSchema.parse({
    type: 'sshHost',
    title: 'Box',
    alias: 'box',
    hostname: 'box.example.com',
    auth: 'key',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  });

/** A server with an account whose vault holds the given items, created from "another device". */
export async function seededServer(items: Item[] = []) {
  const server = new FakeServer();
  const other = createTestClient(server);
  await other.account.createNewAccount({ email: EMAIL, password: PASSWORD, serverUrl: SERVER_URL });
  await other.account.confirmRecoveryKit();
  await other.sync.syncOnce();
  const vaultId = (await other.vault.loadVault()).vaults[0]!.id;
  const ids: string[] = [];
  for (const item of items) ids.push(await other.vault.saveItem(vaultId, item));
  await other.sync.syncOnce();
  return { server, other, vaultId, ids };
}

export function desktopRuntime(server: FakeServer, over: Partial<RuntimeDeps> = {}) {
  const paths = over.paths ?? tempPaths();
  const rt = createRuntime({
    paths,
    dpapi: fakeDpapi,
    fetch: ((i: string | URL | Request, n?: RequestInit) => server.fetch(i, n)) as typeof fetch,
    ...over,
  });
  return { rt, paths };
}

export { generateEd25519 };
