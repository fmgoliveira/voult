import type { Context, MiddlewareHandler } from 'hono';
import type { Config } from './config';

/** Fixed-window in-memory limiter keyed by client IP. */
export function createRateLimiter(limit: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    /** Returns true if the request is allowed. */
    take(key: string, now = Date.now()): boolean {
      const entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
        return true;
      }
      entry.count++;
      return entry.count <= limit;
    },
  };
}

export function clientIp(c: Context, cfg: Config): string {
  if (cfg.trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',').pop()!.trim();
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export function rateLimit(cfg: Config, limit: number, scope: string): MiddlewareHandler {
  const limiter = createRateLimiter(limit);
  return async (c, next) => {
    if (!limiter.take(`${scope}:${clientIp(c, cfg)}`)) {
      c.header('Retry-After', '60');
      return c.json({ error: 'rate_limited' }, 429);
    }
    await next();
  };
}
