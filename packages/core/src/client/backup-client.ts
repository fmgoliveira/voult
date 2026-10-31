import type { Http } from './http';

export interface BackupFile {
  id: string;
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupStatus {
  /** The server has Google OAuth credentials configured. */
  available: boolean;
  /** This account has connected a Google account. */
  connected: boolean;
  /** The connected Google account, when readable. */
  email: string | null;
  enabled: boolean;
  /** Daily by default. */
  intervalHours: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  /** Why the last attempt failed, if it did. */
  lastError: string | null;
  /** Newest first; at most the retention count. */
  files: BackupFile[];
}

/** The server's backup endpoints (Google Drive snapshots). */
export function createBackupClient(http: Http) {
  const call = async <T>(method: string, path: string, body?: unknown) =>
    (await http.requestOk(method, path, body)) as unknown as T;
  return {
    status: () => call<BackupStatus>('GET', '/backup'),
    /** Returns the Google consent URL to open in a browser. */
    startGoogle: () => call<{ url: string }>('POST', '/backup/google/start'),
    disconnect: () => call<{ ok: true }>('DELETE', '/backup/google'),
    setEnabled: (enabled: boolean) => call<{ ok: true }>('PUT', '/backup/settings', { enabled }),
    run: () => call<{ file: BackupFile }>('POST', '/backup/run'),
  };
}

export type BackupClient = ReturnType<typeof createBackupClient>;

const BACKUP_ERRORS: Record<string, string> = {
  google_not_configured: 'This server has no Google credentials set up.',
  google_not_connected: 'Google Drive is not connected.',
  google_access_revoked: 'Google access was revoked. Connect Drive again.',
  google_denied: 'Google refused access. Connect Drive again.',
  google_no_refresh_token: 'Google did not allow offline access. Connect Drive again.',
  google_upload_failed: 'Uploading to Google Drive failed.',
  backup_failed: 'The backup failed.',
};

/** A plain-language reason for a backup error code from the server. */
export const backupErrorMessage = (code: string): string =>
  BACKUP_ERRORS[code] ?? `Backup problem (${code}).`;
