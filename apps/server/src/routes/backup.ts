import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { backupFiles, runBackup, type BackupDeps } from '../backup/service';
import { GoogleError, openToken, sealToken } from '../backup/google';
import { backupSettings } from '../db/schema';
import { parseBody, type Env } from '../http';

const STATE_AUDIENCE = 'voult-backup-oauth';

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>Voult</title><body style="font:16px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">` +
  `<h1>${title}</h1><p>${text}</p></body>`;

/** The browser lands here after Google's consent screen; the signed `state` says who it was. */
export function backupCallbackRoute(deps: BackupDeps) {
  const { cfg, db, google } = deps;
  const app = new Hono();
  app.get('/backup/google/callback', async (c) => {
    if (!google)
      return c.html(page('Not configured', 'This server has no Google credentials.'), 400);
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (c.req.query('error') || !code || !state) {
      return c.html(
        page('Not connected', 'Google did not grant access. You can close this tab.'),
        400,
      );
    }
    let userId: string;
    try {
      const { payload } = await jwtVerify(state, cfg.jwtSecret, { audience: STATE_AUDIENCE });
      if (!payload.sub) throw new Error('no sub');
      userId = payload.sub;
    } catch {
      return c.html(page('Link expired', 'Start the connection again from Voult.'), 400);
    }
    try {
      const { refreshToken, email } = await google.exchangeCode(code);
      const row = {
        userId,
        refreshTokenEnc: sealToken(cfg, refreshToken),
        folderId: null,
        googleEmail: email,
        enabled: 1,
        lastError: null,
      };
      db.insert(backupSettings)
        .values(row)
        .onConflictDoUpdate({ target: backupSettings.userId, set: row })
        .run();
    } catch (e) {
      const code = e instanceof GoogleError ? e.code : 'failed';
      return c.html(page('Not connected', `Google rejected the request (${code}).`), 502);
    }
    return c.html(
      page(
        'Google Drive connected',
        'Voult will back up daily. You can close this tab and return to the app.',
      ),
    );
  });
  return app;
}

/** Authenticated backup endpoints. */
export function backupRoutes(deps: BackupDeps) {
  const { cfg, db, google } = deps;
  const app = new Hono<Env>();

  const settings = (userId: string) =>
    db.select().from(backupSettings).where(eq(backupSettings.userId, userId)).get();

  app.get('/backup', (c) => {
    const userId = c.get('userId');
    const s = settings(userId);
    return c.json({
      available: google !== null,
      connected: !!s,
      email: s?.googleEmail ?? null,
      enabled: !!s?.enabled,
      intervalHours: cfg.backupIntervalHours,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastAttemptAt: s?.lastAttemptAt ?? null,
      lastError: s?.lastError ?? null,
      files: backupFiles(db, userId, cfg.backupRetention),
    });
  });

  app.post('/backup/google/start', async (c) => {
    if (!google) throw new HTTPException(503, { message: 'google_not_configured' });
    const state = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.get('userId'))
      .setAudience(STATE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(cfg.jwtSecret);
    return c.json({ url: google.authUrl(state) });
  });

  app.put('/backup/settings', async (c) => {
    const body = await parseBody(c, z.object({ enabled: z.boolean() }));
    const userId = c.get('userId');
    if (!settings(userId)) throw new HTTPException(409, { message: 'google_not_connected' });
    db.update(backupSettings)
      .set({ enabled: body.enabled ? 1 : 0 })
      .where(eq(backupSettings.userId, userId))
      .run();
    return c.json({ ok: true });
  });

  app.delete('/backup/google', async (c) => {
    const userId = c.get('userId');
    const s = settings(userId);
    if (s && google) {
      try {
        await google.revoke(openToken(cfg, s.refreshTokenEnc));
      } catch {
        /* still disconnect locally */
      }
    }
    db.delete(backupSettings).where(eq(backupSettings.userId, userId)).run();
    return c.json({ ok: true });
  });

  app.post('/backup/run', async (c) => {
    try {
      const r = await runBackup(deps, c.get('userId'));
      return c.json({ file: r.file });
    } catch (e) {
      const code = e instanceof GoogleError ? e.code : 'backup_failed';
      throw new HTTPException(code === 'google_not_connected' ? 409 : 502, { message: code });
    }
  });

  return app;
}
