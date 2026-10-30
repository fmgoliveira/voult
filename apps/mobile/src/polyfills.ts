// Must be the first import of the app: @voult/core assumes web-standard globals.
import 'react-native-url-polyfill/auto';
import * as ExpoCrypto from 'expo-crypto';

const g = globalThis as unknown as { crypto?: Record<string, unknown> };
g.crypto ??= {};
// @noble/* and newId() need a CSPRNG; Hermes does not provide one.
g.crypto.getRandomValues ??= ExpoCrypto.getRandomValues;
g.crypto.randomUUID ??= ExpoCrypto.randomUUID;
