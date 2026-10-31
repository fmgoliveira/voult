import { createSyncEngine } from '@voult/core';
import { http, lock } from './api';
import { store } from './db';
import { getAccountKey } from './session';

export type { SyncResult } from '@voult/core';

const engine = createSyncEngine({ store, http, lock, getAccountKey });

/** Push local changes, then pull remote ones. Safe to call from any extension context. */
export const syncOnce = engine.syncOnce;
