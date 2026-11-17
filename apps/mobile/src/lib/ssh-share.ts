/** How long a shared private key may stay on disk if the share sheet never reports back. */
export const SHARE_FILE_TTL_MS = 60_000;

export interface TempFile {
  uri: string;
  /** Safe to call more than once. */
  remove(): void;
}

export interface ShareDeps {
  /** Write `text` to a new file in the app's cache directory. */
  write(name: string, text: string): TempFile;
  /** Open the system share sheet for the file; resolves when it closes. */
  share(uri: string, mimeType: string, title: string): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/**
 * Hand a secret to another app (Termius) through a short-lived file: write it to the cache, open
 * the share sheet, and delete it as soon as the sheet closes (or after 60 s, whichever is first),
 * even if sharing fails.
 */
export async function shareTempFile(
  deps: ShareDeps,
  name: string,
  text: string,
  title: string,
  ttlMs = SHARE_FILE_TTL_MS,
): Promise<void> {
  const file = deps.write(name, text);
  const timer = deps.setTimer(() => file.remove(), ttlMs);
  try {
    await deps.share(file.uri, 'text/plain', title);
  } finally {
    deps.clearTimer(timer);
    file.remove();
  }
}
