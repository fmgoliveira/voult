import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  /** SQLite file path, or ':memory:'. */
  dbPath: string;
  jwtSecret: Uint8Array;
  /** Allow more than one account. Default false: signup closes after the first account. */
  multiUser: boolean;
  /** Trust X-Forwarded-For (only behind Caddy). */
  trustProxy: boolean;
  accessTtlSec: number;
  loginLimitPerMin: number;
  /** Argon2id parameters for hashing the client auth key at rest. */
  serverKdf: { m: number; t: number; p: number };
  /** Google Drive backups need an OAuth client (Web application) and the server's public URL. */
  google: { clientId: string; clientSecret: string; publicUrl: string } | null;
  backupIntervalHours: number;
  /** Snapshots kept in the "Voult Backups" Drive folder. */
  backupRetention: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const secret = env.JWT_SECRET;
  if (production && (!secret || secret.length < 32)) {
    throw new Error('JWT_SECRET (>= 32 chars) is required in production');
  }
  const dataDir = env.DATA_DIR ?? './data';
  return {
    port: Number(env.PORT ?? 8787),
    dbPath: env.DB_PATH ?? `${dataDir}/voult.db`,
    jwtSecret: new TextEncoder().encode(secret ?? randomBytes(32).toString('hex')),
    multiUser: env.MULTI_USER === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    accessTtlSec: 15 * 60,
    loginLimitPerMin: 5,
    serverKdf: { m: 19 * 1024, t: 2, p: 1 },
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.PUBLIC_URL
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            publicUrl: env.PUBLIC_URL.replace(/\/+$/, ''),
          }
        : null,
    backupIntervalHours: Number(env.BACKUP_INTERVAL_HOURS ?? 24),
    backupRetention: Number(env.BACKUP_RETENTION ?? 30),
  };
}
