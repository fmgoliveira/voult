import { createNodeWebSocket } from '@hono/node-ws';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { verifyAccessToken } from './auth/tokens';
import type { Config } from './config';
import { openDb, type Db } from './db';
import { devices } from './db/schema';
import { Hub } from './hub';
import type { Deps, Env } from './http';
import { accountRoutes, authRoutes } from './routes/auth';
import { syncRoutes } from './routes/sync';

export function createApp(cfg: Config, db?: Db) {
  const handle = db ? { db } : { db: openDb(cfg.dbPath).db };
  const hub = new Hub();
  const deps: Deps = { cfg, db: handle.db, hub };

  const app = new Hono<Env>();
  app.use(secureHeaders());
  app.use(
    bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // Never log request bodies or headers: they may carry secrets.
    console.error('unhandled error:', err.message);
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authRoutes(deps));

  /** Resolves a bearer token to a live (non-revoked) device. */
  async function authenticate(token: string | undefined) {
    const claims = token ? await verifyAccessToken(cfg, token) : null;
    if (!claims) return null;
    const d = deps.db.select().from(devices).where(eq(devices.id, claims.deviceId)).get();
    return d && d.userId === claims.userId ? claims : null;
  }

  // WebSocket: the first message must be {type:"auth", token}; the server then pushes
  // {type:"rev", rev} whenever the user's data changes. Tokens never appear in URLs.
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  app.get(
    '/ws',
    upgradeWebSocket(() => {
      let off: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      return {
        onOpen(_e, ws) {
          timer = setTimeout(() => ws.close(4401, 'auth timeout'), 10_000);
        },
        async onMessage(e, ws) {
          if (off) return;
          try {
            const msg = JSON.parse(String(e.data)) as { type?: string; token?: string };
            const claims = msg.type === 'auth' ? await authenticate(msg.token) : null;
            if (!claims) return ws.close(4401, 'unauthorized');
            clearTimeout(timer);
            off = hub.add(claims.userId, (m) => ws.send(m));
            ws.send(JSON.stringify({ type: 'ready' }));
          } catch {
            ws.close(4400, 'bad message');
          }
        },
        onClose() {
          clearTimeout(timer);
          off?.();
        },
      };
    }),
  );

  const authed = new Hono<Env>();
  authed.use(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const claims = await authenticate(header.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!claims) throw new HTTPException(401, { message: 'unauthorized' });
    c.set('userId', claims.userId);
    c.set('deviceId', claims.deviceId);
    await next();
  });
  authed.route('/', accountRoutes(deps));
  authed.route('/', syncRoutes(deps));
  app.route('/', authed);

  return { app, hub, db: handle.db, injectWebSocket };
}
