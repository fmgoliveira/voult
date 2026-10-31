import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  auth_hash TEXT NOT NULL,
  kdf_params TEXT NOT NULL,
  salt TEXT NOT NULL,
  wrapped_account_key TEXT NOT NULL,
  wrapped_recovery_key TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  refresh_hash TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS devices_user ON devices (user_id);
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  wrapped_vault_key TEXT NOT NULL,
  enc_meta TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS vaults_user_rev ON vaults (user_id, rev);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  type TEXT NOT NULL,
  wrapped_item_key TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS items_user_rev ON items (user_id, rev);
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_user ON backups (user_id, created_at);
CREATE TABLE IF NOT EXISTS backup_settings (
  user_id TEXT PRIMARY KEY,
  refresh_token_enc TEXT NOT NULL,
  folder_id TEXT,
  google_email TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT
);
`;

export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(MIGRATION);
  // Databases created before Phase 8 lack the backup file name.
  const cols = sqlite.prepare('PRAGMA table_info(backups)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'name')) {
    sqlite.exec("ALTER TABLE backups ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

export type Db = ReturnType<typeof openDb>['db'];
export { schema };
