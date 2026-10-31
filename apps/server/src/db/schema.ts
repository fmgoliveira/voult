import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Every secret column holds ciphertext produced client-side. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  authHash: text('auth_hash').notNull(),
  kdfParams: text('kdf_params').notNull(),
  salt: text('salt').notNull(),
  wrappedAccountKey: text('wrapped_account_key').notNull(),
  wrappedRecoveryKey: text('wrapped_recovery_key').notNull(),
  /** Per-user revision counter, bumped on every write. */
  rev: integer('rev').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    refreshHash: text('refresh_hash').notNull(),
    lastSeen: integer('last_seen').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('devices_user').on(t.userId)],
);

export const vaults = sqliteTable(
  'vaults',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    wrappedVaultKey: text('wrapped_vault_key').notNull(),
    encMeta: text('enc_meta').notNull(),
    rev: integer('rev').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('vaults_user_rev').on(t.userId, t.rev)],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    vaultId: text('vault_id').notNull(),
    type: text('type').notNull(),
    wrappedItemKey: text('wrapped_item_key').notNull(),
    ciphertext: text('ciphertext').notNull(),
    /** Client-chosen, bound into the AAD. */
    version: integer('version').notNull(),
    rev: integer('rev').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('items_user_rev').on(t.userId, t.rev)],
);

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  driveFileId: text('drive_file_id').notNull(),
  name: text('name').notNull().default(''),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** One row per user that connected Google Drive. The refresh token is encrypted at rest. */
export const backupSettings = sqliteTable('backup_settings', {
  userId: text('user_id').primaryKey(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  folderId: text('folder_id'),
  googleEmail: text('google_email'),
  enabled: integer('enabled').notNull().default(1),
  lastAttemptAt: integer('last_attempt_at'),
  lastSuccessAt: integer('last_success_at'),
  lastError: text('last_error'),
});
