import { describe, expect, it } from 'vitest';
import { checkForUpdate, isNewerVersion, parseLatestRelease, parseVersion } from './release';

const release = (over: object = {}) => ({
  tag_name: 'v1.2.0',
  html_url: 'https://github.com/fmgoliveira/voult/releases/tag/v1.2.0',
  body: 'notes',
  assets: [
    { name: 'voult.apk', browser_download_url: 'https://github.com/x/voult.apk' },
    { name: 'voult.zip', browser_download_url: 'https://github.com/x/voult.zip' },
  ],
  ...over,
});

describe('versions', () => {
  it('compares semantic versions', () => {
    expect(parseVersion('v1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseVersion('nope')).toBeNull();
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('v1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('garbage', '1.0.0')).toBe(false);
  });
});

describe('update check', () => {
  it('parses the GitHub release and refuses non-GitHub links', () => {
    expect(parseLatestRelease(release())).toMatchObject({
      version: '1.2.0',
      apkUrl: 'https://github.com/x/voult.apk',
    });
    expect(parseLatestRelease(release({ html_url: 'https://evil.example/x' }))).toBeNull();
    expect(
      parseLatestRelease(
        release({ assets: [{ name: 'a.apk', browser_download_url: 'http://evil/a.apk' }] }),
      )?.apkUrl,
    ).toBeNull();
    expect(parseLatestRelease({ tag_name: 'weekly' })).toBeNull();
    // An extension-only release carries the previous APK: its version is the APK's, not the tag's.
    expect(
      parseLatestRelease(
        release({
          tag_name: 'v1.3.0',
          assets: [{ name: 'voult-1.2.0.apk', browser_download_url: 'https://github.com/x/a.apk' }],
        }),
      )?.version,
    ).toBe('1.2.0');
  });

  it('reports an update only when newer, and tolerates "no releases yet"', async () => {
    const ok = (body: unknown, status = 200) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect((await checkForUpdate('1.1.0', ok(release()))).update?.version).toBe('1.2.0');
    expect((await checkForUpdate('1.2.0', ok(release()))).update).toBeNull();
    expect((await checkForUpdate('1.0.0', ok({}, 404))).update).toBeNull();
    await expect(checkForUpdate('1.0.0', ok({}, 500))).rejects.toThrow('update_check_failed');
  });
});
