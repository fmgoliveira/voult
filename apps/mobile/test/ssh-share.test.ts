import { describe, expect, it, vi } from 'vitest';
import { SHARE_FILE_TTL_MS, shareTempFile, type ShareDeps } from '../src/lib/ssh-share';

function fakeDeps(share: ShareDeps['share']) {
  const files = new Map<string, string>();
  const deps: ShareDeps = {
    write(name, text) {
      const uri = `file:///cache/${name}`;
      files.set(uri, text);
      return { uri, remove: () => void files.delete(uri) };
    },
    share,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  return { deps, files };
}

describe('shareTempFile', () => {
  it('shares the file then deletes it', async () => {
    let seen: string | undefined;
    const { deps, files } = fakeDeps(async (uri) => {
      seen = files.get(uri);
    });
    await shareTempFile(deps, 'id_ed25519', 'SECRET', 'Share');
    expect(seen).toBe('SECRET');
    expect(files.size).toBe(0);
  });

  it('deletes the file even if sharing fails', async () => {
    const { deps, files } = fakeDeps(async () => {
      throw new Error('no share target');
    });
    await expect(shareTempFile(deps, 'k', 'SECRET', 'Share')).rejects.toThrow('no share target');
    expect(files.size).toBe(0);
  });

  it('deletes the file after 60 s if the share sheet never reports back', async () => {
    vi.useFakeTimers();
    try {
      const { deps, files } = fakeDeps(() => new Promise<void>(() => undefined));
      void shareTempFile(deps, 'k', 'SECRET', 'Share');
      expect(files.size).toBe(1);
      vi.advanceTimersByTime(SHARE_FILE_TTL_MS - 1);
      expect(files.size).toBe(1);
      vi.advanceTimersByTime(1);
      expect(files.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
