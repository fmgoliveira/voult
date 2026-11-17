import { setArgon2Implementation, WrongPasswordError } from '@voult/core';
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileStore } from '../src/file-store';
import { fakeDpapi } from '../src/dpapi';
import {
  desktopRuntime,
  EMAIL,
  generateEd25519,
  PASSWORD,
  seededServer,
  SERVER_URL,
  sshHostItem,
  sshKeyItem,
  tempPaths,
  useCheapArgon2,
} from './helpers';

beforeAll(useCheapArgon2);
afterAll(() => setArgon2Implementation(null));

describe('desktop runtime', () => {
  it('login → unlock → sync → lock wipes the keys from memory', async () => {
    const key = generateEd25519('deploy');
    const off = generateEd25519('off');
    const { server } = await seededServer([
      sshKeyItem(key),
      sshKeyItem(off, { title: 'Off', agent: { enabled: false } }),
      sshHostItem(),
    ]);
    const { rt } = desktopRuntime(server);

    expect(await rt.status()).toMatchObject({ signedIn: false, unlocked: false });
    const res = await rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    expect(res.error).toBeUndefined();
    expect(await rt.status()).toMatchObject({
      signedIn: true,
      email: EMAIL,
      unlocked: true,
      agentKeys: 1, // only the key with the agent enabled
    });

    const [served] = rt.keyring.list();
    expect(served!.fingerprint).toBe(key.fingerprint);
    // Keep references to the live buffers: lock must overwrite them in place.
    const secret = served!.privateKey;
    expect(Buffer.from(secret).toString()).toContain('BEGIN OPENSSH PRIVATE KEY');

    rt.lock();
    expect(await rt.status()).toMatchObject({ unlocked: false, agentKeys: 0 });
    expect(rt.keyring.list()).toHaveLength(0);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(await rt.loadItems()).toEqual([]);
  });

  it('unlocks with the master password and rejects a wrong one', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519())]);
    const { rt } = desktopRuntime(server);
    await rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    rt.lock();
    await expect(rt.unlock('not the password')).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await rt.status()).unlocked).toBe(false);
    await rt.unlock(PASSWORD);
    expect(await rt.status()).toMatchObject({ unlocked: true, agentKeys: 1 });
  });

  it('keeps the refresh token DPAPI-protected on disk and survives a restart', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519())]);
    const paths = tempPaths();
    const first = desktopRuntime(server, { paths });
    await first.rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    (first.rt.store as FileStore).flush();

    const file = readFileSync(paths.session, 'utf8');
    expect(file).not.toContain('refreshToken');
    const raw = JSON.parse(file).refresh as string;
    const plain = Buffer.from(
      await fakeDpapi.unprotect(new Uint8Array(Buffer.from(raw, 'base64'))),
    ).toString();
    expect(JSON.parse(plain)).toHaveProperty('refreshToken');

    // A new process: no account key, but still signed in and able to unlock + sync.
    const second = desktopRuntime(server, { paths });
    expect(await second.rt.status()).toMatchObject({ signedIn: true, unlocked: false });
    await second.rt.unlock(PASSWORD);
    expect((await second.rt.status()).agentKeys).toBe(1);
    expect(second.rt.keyring.list()[0]!.title).toBe('Deploy');
  });

  it('picks up new keys on sync and drops trashed or disabled ones', async () => {
    const { server, other, vaultId, ids } = await seededServer([sshKeyItem(generateEd25519())]);
    const { rt } = desktopRuntime(server);
    await rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    expect(rt.keyring.size).toBe(1);

    await other.vault.saveItem(vaultId, sshKeyItem(generateEd25519(), { title: 'Second' }));
    await other.sync.syncOnce();
    await rt.sync();
    expect(rt.keyring.size).toBe(2);

    const views = (await other.vault.loadVault()).items;
    await other.vault.trashItem(views.find((v) => v.id === ids[0])!);
    await other.sync.syncOnce();
    await rt.sync();
    expect(rt.keyring.list().map((k) => k.title)).toEqual(['Second']);
  });

  it('locks after the idle time and not before', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519())]);
    let t = 1_000_000;
    const { rt } = desktopRuntime(server, { now: () => t });
    await rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    expect(rt.config.idleLockMinutes).toBe(15);
    t += 14 * 60_000;
    expect(rt.checkIdle()).toBe(false);
    rt.touch();
    t += 14 * 60_000;
    expect(rt.checkIdle()).toBe(false);
    t += 2 * 60_000;
    expect(rt.checkIdle()).toBe(true);
    expect(rt.isUnlocked()).toBe(false);
    expect(rt.checkIdle()).toBe(false); // already locked
  });

  it('logout clears the session file and local data', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519())]);
    const { rt, paths } = desktopRuntime(server);
    await rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    expect(existsSync(paths.session)).toBe(true);
    await rt.logout();
    expect(existsSync(paths.session)).toBe(false);
    expect(await rt.status()).toMatchObject({ signedIn: false, unlocked: false });
  });

  it('can be used offline once it has a local copy', async () => {
    const { server } = await seededServer([sshKeyItem(generateEd25519())]);
    const paths = tempPaths();
    const first = desktopRuntime(server, { paths });
    await first.rt.login({ serverUrl: SERVER_URL, email: EMAIL, password: PASSWORD });
    (first.rt.store as FileStore).flush();
    const offline = desktopRuntime(server, {
      paths,
      fetch: (async () => {
        throw new TypeError('network down');
      }) as typeof fetch,
    });
    const res = await offline.rt.unlock(PASSWORD).catch((e: Error) => e);
    // The local copy loaded before the sync attempt, so the agent has its key either way.
    expect(offline.rt.keyring.size).toBe(1);
    expect(res).toBeDefined();
  });
});
