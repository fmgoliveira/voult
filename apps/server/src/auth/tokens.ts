import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2Verify, argon2id } from 'hash-wasm';
import { SignJWT, jwtVerify } from 'jose';
import type { Config } from '../config';

export interface AccessClaims {
  userId: string;
  deviceId: string;
}

export async function signAccessToken(cfg: Config, claims: AccessClaims): Promise<string> {
  return new SignJWT({ did: claims.deviceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${cfg.accessTtlSec}s`)
    .sign(cfg.jwtSecret);
}

export async function verifyAccessToken(cfg: Config, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.did !== 'string') return null;
    return { userId: payload.sub, deviceId: payload.did };
  } catch {
    return null;
  }
}

export const newRefreshToken = (): string => randomBytes(32).toString('base64url');
export const hashRefreshToken = (t: string): string =>
  createHash('sha256').update(t).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The client's auth key is hashed again server-side so a DB leak does not yield it. */
export async function hashAuthKey(cfg: Config, authKey: string): Promise<string> {
  return argon2id({
    password: authKey,
    salt: randomBytes(16),
    memorySize: cfg.serverKdf.m,
    iterations: cfg.serverKdf.t,
    parallelism: cfg.serverKdf.p,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export const verifyAuthKey = (hash: string, authKey: string): Promise<boolean> =>
  argon2Verify({ password: authKey, hash });
