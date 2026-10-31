import { serializeSnapshot, snapshotChecksum, type Snapshot } from '@voult/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config';
import type { Db } from '../db';
import { backupSettings, backups, items, users, vaults } from '../db/schema';
import { GoogleError, openToken, type GoogleApi } from './google';

export interface BackupDeps {
  cfg: Config;
  db: Db;
  /** Null when the server has no Google credentials. */
  google: GoogleApi | null;
}

/** The user's whole encrypted vault as a self-contained snapshot (no plaintext, no auth data). */
export function buildSnapshot(db: Db, userId: string, now = Date.now()): Snapshot {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) throw new Error('no_user');
  return {
    format: 'voult-snapshot',
    version: 1,
    createdAt: now,
    email: u.email,
    kdfParams: JSON.parse(u.kdfParams),
    salt: u.salt,
    wrappedAccountKey: u.wrappedAccountKey,
    wrappedRecoveryKey: u.wrappedRecoveryKey,
    vaults: db
      .select()
      .from(vaults)
      .where(eq(vaults.userId, userId))
      .orderBy(asc(vaults.id))
      .all()
      .map((v) => ({
        id: v.id,
        wrappedVaultKey: v.wrappedVaultKey,
        encMeta: v.encMeta,
        deletedAt: v.deletedAt,
      })),
    items: db
      .select()
      .from(items)
      .where(eq(items.userId, userId))
      .orderBy(asc(items.id))
      .all()
      .map((i) => ({
        id: i.id,
        vaultId: i.vaultId,
        type: i.type,
        wrappedItemKey: i.wrappedItemKey,
        ciphertext: i.ciphertext,
        version: i.version,
        rev: i.rev,
        updatedAt: i.updatedAt,
        deletedAt: i.deletedAt,
      })),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
export function backupName(at: number): string {
  const d = new Date(at);
  return (
    `voult-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}Z.voult`
  );
}

/** Uploads one snapshot to Drive, prunes old ones, and records success or failure. */
export async function runBackup(deps: BackupDeps, userId: string, now = Date.now()) {
  const { cfg, db, google } = deps;
  if (!google) throw new GoogleError('google_not_configured');
  const settings = db.select().from(backupSettings).where(eq(backupSettings.userId, userId)).get();
  if (!settings) throw new GoogleError('google_not_connected');

  db.update(backupSettings)
    .set({ lastAttemptAt: now })
    .where(eq(backupSettings.userId, userId))
    .run();
  try {
    const token = await google.accessToken(openToken(cfg, settings.refreshTokenEnc));
    const folderId = await google.ensureFolder(token, settings.folderId);
    const snapshot = buildSnapshot(db, userId, now);
    const text = serializeSnapshot(snapshot);
    const name = backupName(now);
    const file = await google.upload(token, folderId, name, text);
    db.insert(backups)
      .values({
        id: randomUUID(),
        userId,
        driveFileId: file.id,
        name,
        size: file.size,
        createdAt: now,
      })
      .run();

    // Keep the newest N: trust Drive's own listing (it also covers files from earlier installs).
    const all = await google.list(token, folderId);
    for (const old of all.slice(cfg.backupRetention)) {
      await google.remove(token, old.id);
      db.delete(backups)
        .where(and(eq(backups.userId, userId), eq(backups.driveFileId, old.id)))
        .run();
    }
    db.update(backupSettings)
      .set({ folderId, lastSuccessAt: now, lastError: null })
      .where(eq(backupSettings.userId, userId))
      .run();
    return {
      file: { id: file.id, name, size: file.size, createdAt: now },
      checksum: snapshotChecksum(snapshot),
    };
  } catch (e) {
    const code = e instanceof GoogleError ? e.code : 'backup_failed';
    db.update(backupSettings)
      .set({ lastError: code })
      .where(eq(backupSettings.userId, userId))
      .run();
    throw e;
  }
}

/** Runs the backups that are due (daily by default); a failure waits an hour before retrying. */
export async function runDueBackups(deps: BackupDeps, now = Date.now()): Promise<number> {
  if (!deps.google) return 0;
  const interval = deps.cfg.backupIntervalHours * 3_600_000;
  let ran = 0;
  for (const s of deps.db.select().from(backupSettings).all()) {
    if (!s.enabled) continue;
    if (s.lastSuccessAt && now - s.lastSuccessAt < interval) continue;
    if (s.lastAttemptAt && s.lastError && now - s.lastAttemptAt < 3_600_000) continue;
    try {
      await runBackup(deps, s.userId, now);
      ran++;
    } catch (e) {
      console.error('backup failed:', e instanceof GoogleError ? e.code : 'unexpected error');
    }
  }
  return ran;
}

export function backupFiles(db: Db, userId: string, limit: number) {
  return db
    .select()
    .from(backups)
    .where(eq(backups.userId, userId))
    .orderBy(desc(backups.createdAt))
    .limit(limit)
    .all()
    .map((b) => ({ id: b.driveFileId, name: b.name, size: b.size, createdAt: b.createdAt }));
}
