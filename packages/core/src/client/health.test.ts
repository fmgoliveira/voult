import { describe, expect, it } from 'vitest';
import { blankItem } from './blank-item';
import { analyzeHealth, checkBreached, breachedLogins, passwordStrength, sha1Hex } from './health';
import type { ItemView } from './types';
import type { LoginItem } from '../vault/schemas';

const DAY = 24 * 60 * 60 * 1000;
const view = (id: string, patch: Partial<LoginItem>): ItemView => ({
  id,
  vaultId: 'v',
  item: { ...(blankItem('login') as LoginItem), title: id, ...patch },
  deletedAt: null,
  dirty: false,
});

describe('passwordStrength', () => {
  it('rates common, short and patterned passwords low and long random ones high', () => {
    expect(passwordStrength('password').score).toBe(0);
    expect(passwordStrength('Password123!').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('abcd1234').score).toBe(0);
    expect(passwordStrength('aaaaaaaa').score).toBeLessThanOrEqual(1);
    expect(passwordStrength('x7#Qm9$vLp2@Rt8!').score).toBeGreaterThanOrEqual(3);
    expect(passwordStrength('correct horse battery staple pony').score).toBe(4);
    expect(passwordStrength('').score).toBe(0);
  });
});

describe('analyzeHealth', () => {
  const now = 1_000 * DAY;
  const items = [
    view('weak', { password: '123456', createdAt: now }),
    view('a', { password: 'x7#Qm9$vLp2@Rt8!', createdAt: now }),
    view('b', { password: 'x7#Qm9$vLp2@Rt8!', createdAt: now }),
    view('old', { password: 'Zk4%tY8&wN1*pQ6^', createdAt: now - 400 * DAY }),
    view('rotated', {
      password: 'Hg3$eR7@uI9#oP5!',
      createdAt: now - 800 * DAY,
      passwordHistory: [{ password: 'x', changedAt: now - 10 * DAY }],
    }),
    { ...view('trashed', { password: '123456' }), deletedAt: 5 },
    view('nopw', { password: '' }),
  ];
  it('finds weak, reused and old passwords, ignoring trash and empty ones', () => {
    const r = analyzeHealth(items, now);
    expect(r.total).toBe(5);
    expect(r.weak.map((v) => v.id)).toEqual(['weak']);
    expect(r.reused.map((g) => g.map((v) => v.id))).toEqual([['a', 'b']]);
    expect(r.old.map((v) => v.id)).toEqual(['old']);
    expect(r.score).toBe(20); // only "rotated" is clean
  });
});

describe('breach check (HIBP k-anonymity)', () => {
  it('sends only a 5 character prefix and finds matches by suffix', async () => {
    expect(sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const seen: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push(url);
      expect((init?.headers as Record<string, string>)['Add-Padding']).toBe('true');
      const prefix = url.split('/').pop();
      const body =
        prefix === '5BAA6'
          ? '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0000000000000000000000000000000000A:0'
          : 'ABCDEF0123456789ABCDEF0123456789ABC:3';
      return new Response(body);
    }) as unknown as typeof fetch;

    const counts = await checkBreached(['password', 'x7#Qm9$vLp2@Rt8!'], fetchFn);
    expect(counts.get('password')).toBe(9545824);
    expect(counts.has('x7#Qm9$vLp2@Rt8!')).toBe(false);
    expect(seen).toHaveLength(2);
    for (const u of seen) expect(u).toMatch(/\/range\/[0-9A-F]{5}$/);
    expect(seen.join()).not.toContain('5BAA61E4C9B9');

    const hit = await breachedLogins(
      [view('p', { password: 'password' }), view('q', { password: 'x7#Qm9$vLp2@Rt8!' })],
      fetchFn,
    );
    expect(hit.map((h) => [h.item.id, h.count])).toEqual([['p', 9545824]]);
  });

  it('fails loudly when the service errors', async () => {
    const bad = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(checkBreached(['x'], bad)).rejects.toThrow('breach_check_failed');
  });
});
