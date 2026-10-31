import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';
import { runDueBackups } from './backup/service';
import { purgeTrash } from './jobs';

const cfg = loadConfig();
const { db } = openDb(cfg.dbPath);
const { app, injectWebSocket, backupDeps } = createApp(cfg, db);

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`voult server listening on :${info.port}`);
});
injectWebSocket(server);

purgeTrash(db);
setInterval(() => purgeTrash(db), 24 * 60 * 60 * 1000).unref();

// Daily Drive backups: check every 15 minutes which accounts are due.
if (backupDeps.google) {
  const tick = () => void runDueBackups(backupDeps);
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
