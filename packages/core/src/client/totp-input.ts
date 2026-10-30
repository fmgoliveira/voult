import { parseOtpauthUri } from '../totp/otpauth';
import type { LoginItem } from '../vault/schemas';

/** Accepts a bare base32 secret or a full otpauth:// URI. */
export function parseTotpInput(input: string, prev: LoginItem['totp']) {
  const text = input.trim();
  if (!text) return undefined;
  if (text.startsWith('otpauth://')) return parseOtpauthUri(text);
  return {
    ...(prev ?? {
      kind: 'totp',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      counter: 0,
      issuer: '',
      account: '',
    }),
    secret: text.replace(/\s/g, '').toUpperCase(),
  } as NonNullable<LoginItem['totp']>;
}
