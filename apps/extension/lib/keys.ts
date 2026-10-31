import { openVaults as openVaultsFor } from '@voult/core';
import { store } from './db';

/** Decrypt all vault keys + metadata with the account key. */
export const openVaults = (accountKey: Uint8Array) => openVaultsFor(store, accountKey);
