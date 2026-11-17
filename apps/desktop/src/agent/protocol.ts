/**
 * The SSH agent protocol (draft-miller-ssh-agent): a pure codec with no I/O.
 * Only listing identities and signing are supported; everything else is answered with FAILURE.
 */

export const MSG = {
  FAILURE: 5,
  SUCCESS: 6,
  REQUEST_IDENTITIES: 11,
  IDENTITIES_ANSWER: 12,
  SIGN_REQUEST: 13,
  SIGN_RESPONSE: 14,
  /** Add/remove identity, lock, unlock, extensions… (answered with FAILURE). */
} as const;

/** `flags` in SIGN_REQUEST for RSA keys. */
export const SIGN_FLAG = { RSA_SHA2_256: 2, RSA_SHA2_512: 4 } as const;

/** An agent message is never this large in practice; refuse bigger frames. */
export const MAX_MESSAGE = 256 * 1024;

export class ProtocolError extends Error {}

export type AgentRequest =
  | { type: 'identities' }
  | { type: 'sign'; keyBlob: Uint8Array; data: Uint8Array; flags: number }
  | { type: 'unsupported'; code: number };

export interface Identity {
  blob: Uint8Array;
  comment: string;
}

const u32 = (n: number): Uint8Array =>
  Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const readU32 = (b: Uint8Array, o: number): number =>
  b[o]! * 0x1000000 + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;

/** Length-prefixed string. */
export const sshString = (b: Uint8Array): Uint8Array => cat(u32(b.length), b);

function frame(type: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  return cat(u32(payload.length + 1), Uint8Array.of(type), payload);
}

export const failure = (): Uint8Array => frame(MSG.FAILURE);

export function identitiesAnswer(ids: readonly Identity[]): Uint8Array {
  const enc = new TextEncoder();
  return frame(
    MSG.IDENTITIES_ANSWER,
    cat(
      u32(ids.length),
      ...ids.flatMap((i) => [sshString(i.blob), sshString(enc.encode(i.comment))]),
    ),
  );
}

/** `signature` is the complete signature blob: `string algorithm || string data`. */
export function signResponse(signature: Uint8Array): Uint8Array {
  return frame(MSG.SIGN_RESPONSE, sshString(signature));
}

/** Parse the body of one frame (the bytes after the 4-byte length). */
export function parseRequest(body: Uint8Array): AgentRequest {
  if (body.length < 1) throw new ProtocolError('empty message');
  const type = body[0]!;
  if (type === MSG.REQUEST_IDENTITIES) return { type: 'identities' };
  if (type !== MSG.SIGN_REQUEST) return { type: 'unsupported', code: type };
  let o = 1;
  const str = (): Uint8Array => {
    if (o + 4 > body.length) throw new ProtocolError('truncated message');
    const n = readU32(body, o);
    o += 4;
    if (n > body.length - o) throw new ProtocolError('truncated message');
    const s = body.subarray(o, o + n);
    o += n;
    return s;
  };
  const keyBlob = str();
  const data = str();
  if (o + 4 > body.length) throw new ProtocolError('truncated message');
  return { type: 'sign', keyBlob, data, flags: readU32(body, o) };
}

/** Splits a byte stream into agent messages, however the chunks fall. */
export class FrameReader {
  private buf: Uint8Array = new Uint8Array(0);

  /** Add received bytes; returns every complete message body now available. */
  push(chunk: Uint8Array): Uint8Array[] {
    this.buf = cat(this.buf, chunk);
    const out: Uint8Array[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const n = readU32(this.buf, 0);
      if (n > MAX_MESSAGE) throw new ProtocolError('message too large');
      if (this.buf.length < 4 + n) break;
      out.push(this.buf.slice(4, 4 + n));
      this.buf = this.buf.slice(4 + n);
    }
    return out;
  }
}
