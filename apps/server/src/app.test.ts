import { describe, expect, it } from 'vitest';
import { app } from './app';

describe('server', () => {
  it('reports health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
