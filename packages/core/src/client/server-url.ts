/** Validate and canonicalise a server URL: https only, except loopback for development. */
export function normalizeServerUrl(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) {
    throw new Error('Server URL must use https');
  }
  return u.origin;
}
