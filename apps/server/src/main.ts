import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db';
import { purgeTrash } from './jobs';

const cfg = loadConfig();
const { db } = openDb(cfg.dbPath);
const { app, injectWebSocket } = createApp(cfg, db);

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`voult server listening on :${info.port}`);
});
injectWebSocket(server);

purgeTrash(db);
setInterval(() => purgeTrash(db), 24 * 60 * 60 * 1000).unref();
