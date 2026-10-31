/** "1.2.3" or "v1.2.3-beta.1" to [1, 2, 3]; anything else is null. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `latest` is a newer release than `current`. Unparseable versions never count as newer. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  return false;
}

export interface LatestRelease {
  version: string;
  url: string;
  /** Direct link to the APK asset, when the release has one. */
  apkUrl: string | null;
  notes: string;
}

/**
 * Reads GitHub's "latest release" API response. Drafts and pre-releases are ignored by the API
 * itself; we still refuse anything that is not an https link back to github.com.
 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  const r = json as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  if (!r?.tag_name || !parseVersion(r.tag_name) || !r.html_url) return null;
  const https = (u?: string) => (u && /^https:\/\/github\.com\//.test(u) ? u : null);
  const url = https(r.html_url);
  if (!url) return null;
  const apk = r.assets?.find((a) => a.name?.endsWith('.apk'));
  return {
    version: r.tag_name.replace(/^v/, ''),
    url,
    apkUrl: https(apk?.browser_download_url),
    notes: (r.body ?? '').slice(0, 2000),
  };
}

export const RELEASES_API = 'https://api.github.com/repos/fmgoliveira/voult/releases/latest';

/** Asks GitHub for the newest release. Only called when the user taps "Check for updates". */
export async function checkForUpdate(
  current: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ update: LatestRelease | null }> {
  const res = await fetchFn(RELEASES_API, { headers: { accept: 'application/vnd.github+json' } });
  if (res.status === 404) return { update: null }; // no release published yet
  if (!res.ok) throw new Error('update_check_failed');
  const latest = parseLatestRelease(await res.json());
  return { update: latest && isNewerVersion(latest.version, current) ? latest : null };
}
