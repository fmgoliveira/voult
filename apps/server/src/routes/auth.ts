import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  hashAuthKey,
  hashRefreshToken,
  newRefreshToken,
  safeEqual,
  signAccessToken,
  verifyAuthKey,
} from '../auth/tokens';
import { devices, users } from '../db/schema';
import { parseBody, type Deps, type Env } from '../http';
import { rateLimit } from '../ratelimit';

const b64 = z.string().min(1).max(4096);
const kdfParams = z.object({
  m: z.number().int().min(8).max(1_048_576),
  t: z.number().int().min(1).max(100),
  p: z.number().int().min(1).max(16),
});
const device = z.object({
  name: z.string().min(1).max(100),
  platform: z.enum(['chrome', 'firefox', 'android', 'other']),
});

const signupBody = z.object({
  email: z.email().max(254),
  authKey: b64,
  kdfParams,
  salt: b64,
  wrappedAccountKey: b64,
  wrappedRecoveryKey: b64,
  device,
});
const loginBody = z.object({
  email: z.email().max(254),
  authKey: b64,
  device,
  deviceId: z.string().optional(),
});
const refreshBody = z.object({ deviceId: z.string(), refreshToken: z.string() });
const changePasswordBody = z.object({
  currentAuthKey: b64,
  authKey: b64,
  salt: b64,
  kdfParams,
  wrappedAccountKey: b64,
});

const normEmail = (e: string) => e.trim().toLowerCase();

export function authRoutes({ cfg, db }: Deps) {
  const app = new Hono<Env>();
  const now = () => Date.now();

  async function issue(userId: string, deviceId: string) {
    const refreshToken = newRefreshToken();
    db.update(devices)
      .set({ refreshHash: hashRefreshToken(refreshToken), lastSeen: now() })
      .where(eq(devices.id, deviceId))
      .run();
    return {
      userId,
      deviceId,
      refreshToken,
      accessToken: await signAccessToken(cfg, { userId, deviceId }),
      expiresIn: cfg.accessTtlSec,
    };
  }

  function createDevice(userId: string, d: z.infer<typeof device>): string {
    const id = randomUUID();
    db.insert(devices)
      .values({
        id,
        userId,
        name: d.name,
        platform: d.platform,
        refreshHash: '',
        lastSeen: now(),
        createdAt: now(),
      })
      .run();
    return id;
  }

  app.post('/signup', rateLimit(cfg, 20, 'signup'), async (c) => {
    const body = await parseBody(c, signupBody);
    const existing = db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .get()!.n;
    if (existing > 0 && !cfg.multiUser) throw new HTTPException(403, { message: 'signup_closed' });
    const email = normEmail(body.email);
    if (db.select().from(users).where(eq(users.email, email)).get()) {
      throw new HTTPException(409, { message: 'email_taken' });
    }
    const userId = randomUUID();
    db.insert(users)
      .values({
        id: userId,
        email,
        authHash: await hashAuthKey(cfg, body.authKey),
        kdfParams: JSON.stringify(body.kdfParams),
        salt: body.salt,
        wrappedAccountKey: body.wrappedAccountKey,
        wrappedRecoveryKey: body.wrappedRecoveryKey,
        createdAt: now(),
      })
      .run();
    return c.json(await issue(userId, createDevice(userId, body.device)), 201);
  });

  // Unknown emails get a stable fake salt so the endpoint does not reveal which accounts exist.
  app.get('/prelogin', rateLimit(cfg, 30, 'prelogin'), (c) => {
    const email = normEmail(c.req.query('email') ?? '');
    const u = db.select().from(users).where(eq(users.email, email)).get();
    if (u) return c.json({ salt: u.salt, kdfParams: JSON.parse(u.kdfParams) });
    const fake = createHmac('sha256', cfg.jwtSecret).update(`prelogin:${email}`).digest();
    return c.json({
      salt: fake.subarray(0, 16).toString('base64url'),
      kdfParams: { m: 64 * 1024, t: 3, p: 1 },
    });
  });

  let dummyHash: Promise<string> | undefined;

  app.post('/login', rateLimit(cfg, cfg.loginLimitPerMin, 'login'), async (c) => {
    const body = await parseBody(c, loginBody);
    const u = db
      .select()
      .from(users)
      .where(eq(users.email, normEmail(body.email)))
      .get();
    // Always run one verification so timing does not reveal whether the account exists.
    const hash = u?.authHash ?? (await (dummyHash ??= hashAuthKey(cfg, 'dummy')));
    const ok = await verifyAuthKey(hash, body.authKey);
    if (!u || !ok) throw new HTTPException(401, { message: 'invalid_credentials' });

    let deviceId = body.deviceId;
    const known = deviceId
      ? db
          .select()
          .from(devices)
          .where(and(eq(devices.id, deviceId), eq(devices.userId, u.id)))
          .get()
      : undefined;
    if (!known) deviceId = createDevice(u.id, body.device);
    return c.json({
      ...(await issue(u.id, deviceId!)),
      account: {
        kdfParams: JSON.parse(u.kdfParams),
        salt: u.salt,
        wrappedAccountKey: u.wrappedAccountKey,
        wrappedRecoveryKey: u.wrappedRecoveryKey,
      },
    });
  });

  // Rotating refresh tokens. Presenting a stale token means it leaked: revoke the device.
  app.post('/refresh', rateLimit(cfg, 60, 'refresh'), async (c) => {
    const body = await parseBody(c, refreshBody);
    const d = db.select().from(devices).where(eq(devices.id, body.deviceId)).get();
    if (!d) throw new HTTPException(401, { message: 'invalid_refresh' });
    if (!safeEqual(d.refreshHash, hashRefreshToken(body.refreshToken))) {
      db.delete(devices).where(eq(devices.id, d.id)).run();
      throw new HTTPException(401, { message: 'invalid_refresh' });
    }
    return c.json(await issue(d.userId, d.id));
  });

  return app;
}

/** Routes that require a valid access token. */
export function accountRoutes({ cfg, db }: Deps) {
  const app = new Hono<Env>();

  app.get('/account', (c) => {
    const u = db
      .select()
      .from(users)
      .where(eq(users.id, c.get('userId')))
      .get()!;
    return c.json({
      id: u.id,
      email: u.email,
      rev: u.rev,
      kdfParams: JSON.parse(u.kdfParams),
      salt: u.salt,
      wrappedAccountKey: u.wrappedAccountKey,
      wrappedRecoveryKey: u.wrappedRecoveryKey,
    });
  });

  app.post('/auth/logout', (c) => {
    db.delete(devices)
      .where(eq(devices.id, c.get('deviceId')))
      .run();
    return c.body(null, 204);
  });

  app.post('/auth/change-password', async (c) => {
    const body = await parseBody(c, changePasswordBody);
    const u = db
      .select()
      .from(users)
      .where(eq(users.id, c.get('userId')))
      .get()!;
    if (!(await verifyAuthKey(u.authHash, body.currentAuthKey))) {
      throw new HTTPException(401, { message: 'invalid_credentials' });
    }
    db.update(users)
      .set({
        authHash: await hashAuthKey(cfg, body.authKey),
        salt: body.salt,
        kdfParams: JSON.stringify(body.kdfParams),
        wrappedAccountKey: body.wrappedAccountKey,
      })
      .where(eq(users.id, u.id))
      .run();
    // Other devices must sign in again with the new password.
    db.delete(devices)
      .where(and(eq(devices.userId, u.id), ne(devices.id, c.get('deviceId'))))
      .run();
    return c.body(null, 204);
  });

  app.get('/devices', (c) => {
    const rows = db
      .select()
      .from(devices)
      .where(eq(devices.userId, c.get('userId')))
      .all();
    return c.json(
      rows.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeen: d.lastSeen,
        createdAt: d.createdAt,
        current: d.id === c.get('deviceId'),
      })),
    );
  });

  app.delete('/devices/:id', (c) => {
    const r = db
      .delete(devices)
      .where(and(eq(devices.id, c.req.param('id')), eq(devices.userId, c.get('userId'))))
      .run();
    if (r.changes === 0) throw new HTTPException(404, { message: 'not_found' });
    return c.body(null, 204);
  });

  return app;
}
