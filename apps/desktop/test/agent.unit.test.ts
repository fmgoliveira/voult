import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import {
  parsePrivateKey,
  publicKeyBlob,
  toNodeKeyObjectInput,
  type ParsedSshKey,
  type SshKeyType,
} from '@voult/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTaskArgs, deleteTaskArgs, TASK_NAME } from '../src/agent/install';
import {
  diagnose,
  FIX_BUILTIN_AGENT,
  parseSshVersion,
  supportsAskpassForce,
  type Probes,
} from '../src/agent/doctor';
import {
  failure,
  FrameReader,
  identitiesAnswer,
  MAX_MESSAGE,
  MSG,
  parseRequest,
  ProtocolError,
  signResponse,
  sshString,
} from '../src/agent/protocol';
import { handleAgentMessage, type AgentDeps } from '../src/agent/server';
import { signWithKey, SignError } from '../src/agent/sign';
import { Keyring, type AgentKey } from '../src/keyring';
import { generateEd25519 } from './helpers';

const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const FIXTURES = path.resolve(__dirname, '../../../packages/core/test/fixtures/ssh');
const fixture = (n: string) => parsePrivateKey(readFileSync(path.join(FIXTURES, n), 'utf8'));

// Packets captured from the Windows OpenSSH client 9.5p2 talking to an agent.
const CAPTURED = {
  /** session-bind@openssh.com extension (ssh sends it first; the agent must answer FAILURE). */
  extension:
    '1b0000001873657373696f6e2d62696e64406f70656e7373682e636f6d000000330000000b7373682d65643235353139000000205732bd4672a3e4d582ef707086f4785e91822903c16bdf156bb3c8e6183f6c9e00000020d986efa50de1be7fbb5925a15b23306b0ac2604694cc49a59a61003022e7b970000000530000000b7373682d65643235353139000000407ceeacbbb996e6d62f602c53aa7c44d1fe7caeaf64bfe6245c365eefa708d3153a1f0174b3d31bc56cde4f736614f9f2f79f81b7dc684ebee8c55f6cc4c7f30e00',
  identities: '0b',
  /** SIGN_REQUEST for an ed25519 key, flags 0. */
  sign: '0d000000330000000b7373682d6564323535313900000020d4db1807fb72cf341102a2ff3ab3cb7e1075db00cf84f9a09ee45a03294a6d800000009000000020d986efa50de1be7fbb5925a15b23306b0ac2604694cc49a59a61003022e7b9703200000001750000000e7373682d636f6e6e656374696f6e000000097075626c69636b6579010000000b7373682d65643235353139000000330000000b7373682d6564323535313900000020d4db1807fb72cf341102a2ff3ab3cb7e1075db00cf84f9a09ee45a03294a6d8000000000',
  /** The agent's IDENTITIES_ANSWER for one key with comment "cap" (frame body, with length). */
  answer:
    '000000430c00000001000000330000000b7373682d6564323535313900000020d4db1807fb72cf341102a2ff3ab3cb7e1075db00cf84f9a09ee45a03294a6d8000000003636170',
};

describe('agent protocol codec', () => {
  it('parses captured requests', () => {
    expect(parseRequest(hex(CAPTURED.identities))).toEqual({ type: 'identities' });
    expect(parseRequest(hex(CAPTURED.extension))).toEqual({ type: 'unsupported', code: 27 });
    const sign = parseRequest(hex(CAPTURED.sign));
    expect(sign.type).toBe('sign');
    if (sign.type !== 'sign') return;
    expect(sign.flags).toBe(0);
    expect(Buffer.from(sign.keyBlob).toString('hex')).toBe(
      '0000000b7373682d6564323535313900000020d4db1807fb72cf341102a2ff3ab3cb7e1075db00cf84f9a09ee45a03294a6d80',
    );
    expect(sign.data).toHaveLength(144);
    expect(Buffer.from(sign.data.subarray(0, 4)).toString('hex')).toBe('00000020'); // session id
  });

  it('builds the answer OpenSSH expects byte for byte', () => {
    const blob = hex(
      '0000000b7373682d6564323535313900000020d4db1807fb72cf341102a2ff3ab3cb7e1075db00cf84f9a09ee45a03294a6d80',
    );
    expect(Buffer.from(identitiesAnswer([{ blob, comment: 'cap' }])).toString('hex')).toBe(
      CAPTURED.answer,
    );
    expect(Buffer.from(failure()).toString('hex')).toBe('0000000105');
    expect(identitiesAnswer([])).toEqual(hex('000000050c00000000'));
    const sig = Uint8Array.of(1, 2, 3);
    expect(Buffer.from(signResponse(sig)).toString('hex')).toBe('000000080e00000003010203');
    expect(sshString(Uint8Array.of(9))).toEqual(hex('0000000109'));
  });

  it('rejects truncated and empty messages', () => {
    expect(() => parseRequest(new Uint8Array(0))).toThrow(ProtocolError);
    const sign = hex(CAPTURED.sign);
    expect(() => parseRequest(sign.subarray(0, 20))).toThrow(ProtocolError);
    expect(() => parseRequest(sign.subarray(0, sign.length - 2))).toThrow(ProtocolError);
    expect(() => parseRequest(hex('0d0000'))).toThrow(ProtocolError);
    expect(() => parseRequest(hex('0d000000010000000000'))).toThrow(ProtocolError);
  });

  it('frames a stream however it is chunked', () => {
    const wire = Buffer.concat([
      Buffer.from('00000001' + '0b', 'hex'),
      Buffer.from('00000002' + '1b00', 'hex'),
    ]);
    for (let split = 1; split < wire.length; split++) {
      const r = new FrameReader();
      const got = [...r.push(wire.subarray(0, split)), ...r.push(wire.subarray(split))];
      expect(got.map((b) => Buffer.from(b).toString('hex'))).toEqual(['0b', '1b00']);
    }
    expect(() => new FrameReader().push(hex('ffffffff'))).toThrow(ProtocolError);
    expect(MAX_MESSAGE).toBeLessThan(0xffffffff);
    expect(MSG.SIGN_REQUEST).toBe(13);
  });
});

// ------------------------------------------------------------------ signing

function agentKey(parsed: ParsedSshKey, over: Partial<AgentKey> = {}): AgentKey {
  return {
    itemId: 'i',
    title: 'k',
    keyType: parsed.keyType,
    fingerprint: parsed.fingerprint,
    blob: publicKeyBlob(parsed.publicKey),
    confirm: false,
    privateKey: new TextEncoder().encode(parsed.privateKey),
    ...over,
  };
}

/** Split `string alg || string sig` and return both. */
function splitSignature(blob: Uint8Array): { alg: string; sig: Buffer } {
  const b = Buffer.from(blob);
  const algLen = b.readUInt32BE(0);
  const alg = b.subarray(4, 4 + algLen).toString();
  const sigLen = b.readUInt32BE(4 + algLen);
  return { alg, sig: b.subarray(8 + algLen, 8 + algLen + sigLen) };
}

/** Read two SSH mpints (r, s) and return them as fixed-width big-endian halves. */
function ecdsaHalves(sig: Buffer, size: number): Buffer {
  const out: Buffer[] = [];
  let o = 0;
  for (let i = 0; i < 2; i++) {
    const n = sig.readUInt32BE(o);
    let v = sig.subarray(o + 4, o + 4 + n);
    o += 4 + n;
    while (v.length > size) v = v.subarray(1);
    out.push(Buffer.concat([Buffer.alloc(size - v.length), v]));
  }
  return Buffer.concat(out);
}

describe('signWithKey', () => {
  const data = Buffer.from('some data to sign');
  const cases: [string, string, SshKeyType, number, string, string | null][] = [
    ['ed25519', 'ed25519', 'ed25519', 0, 'ssh-ed25519', null],
    ['rsa-sha2-256', 'rsa3072', 'rsa', 2, 'rsa-sha2-256', 'sha256'],
    ['rsa-sha2-512', 'rsa3072', 'rsa', 4, 'rsa-sha2-512', 'sha512'],
    ['ecdsa p256', 'ecdsa256', 'ecdsa-p256', 0, 'ecdsa-sha2-nistp256', 'sha256'],
    ['ecdsa p384', 'ecdsa384', 'ecdsa-p384', 0, 'ecdsa-sha2-nistp384', 'sha384'],
  ];
  it.each(cases)('%s', (_name, file, type, flags, alg, hash) => {
    const parsed = file === 'ed25519' ? generateEd25519('t') : fixture(file);
    expect(parsed.keyType).toBe(type);
    const key = agentKey(parsed);
    const { alg: gotAlg, sig } = splitSignature(signWithKey(key, data, flags));
    expect(gotAlg).toBe(alg);

    const publicObj = createPublicKey(
      createPrivateKey({ key: toNodeKeyObjectInput(parsed.privateKey) as never, format: 'jwk' }),
    );
    if (type === 'ecdsa-p256' || type === 'ecdsa-p384') {
      const p1363 = ecdsaHalves(sig, type === 'ecdsa-p256' ? 32 : 48);
      expect(verify(hash, data, { key: publicObj, dsaEncoding: 'ieee-p1363' }, p1363)).toBe(true);
    } else {
      expect(verify(hash, data, publicObj, sig)).toBe(true);
    }
  });

  it('refuses legacy ssh-rsa (SHA-1) signatures', () => {
    expect(() => signWithKey(agentKey(fixture('rsa3072')), data, 0)).toThrow(SignError);
  });

  it('reports an unloadable key', () => {
    const key = agentKey(generateEd25519('x'), { privateKey: new Uint8Array(4) });
    expect(() => signWithKey(key, data, 0)).toThrow(SignError);
  });
});

// ------------------------------------------------------------------ request handling

function harness(over: Partial<AgentDeps> = {}) {
  const parsed = generateEd25519('deploy');
  const key = agentKey(parsed, { title: 'Deploy' });
  const keyring = new Keyring();
  keyring.replace([key]);
  const log: string[] = [];
  const state = { unlocked: true, locked: 0, touched: 0, confirms: 0, answer: true };
  const deps: AgentDeps = {
    keyring,
    isUnlocked: () => state.unlocked,
    touch: () => void state.touched++,
    notifyLocked: () => void state.locked++,
    confirm: async () => {
      state.confirms++;
      return state.answer;
    },
    logUse: (l) => log.push(l),
    now: () => new Date('2026-01-02T03:04:05Z'),
    ...over,
  };
  const signBody = (flags = 0) =>
    Buffer.concat([
      Buffer.from([13]),
      Buffer.from(sshString(key.blob)),
      Buffer.from(sshString(Buffer.from('payload'))),
      Buffer.from([0, 0, 0, flags]),
    ]);
  return { deps, key, keyring, log, state, signBody };
}

describe('handleAgentMessage', () => {
  it('lists identities with the key title as comment', async () => {
    const h = harness();
    const res = await handleAgentMessage(h.deps, hex('0b'));
    expect(Buffer.from(res).toString('hex')).toBe(
      Buffer.from(identitiesAnswer([{ blob: h.key.blob, comment: 'Deploy' }])).toString('hex'),
    );
  });

  it('signs, logs the use without secrets, and counts it as activity', async () => {
    const h = harness();
    const res = await handleAgentMessage(h.deps, h.signBody());
    expect(res[4]).toBe(MSG.SIGN_RESPONSE);
    expect(h.state.touched).toBe(1);
    expect(h.log).toEqual([`2026-01-02T03:04:05.000Z SIGN ${h.key.fingerprint} client=unknown`]);
  });

  it('answers FAILURE for add/remove identity, extensions and garbage', async () => {
    const h = harness();
    for (const body of [hex('11'), hex('12'), hex('1b0000'), hex('0d0000'), hex('')]) {
      expect(await handleAgentMessage(h.deps, body)).toEqual(failure());
    }
  });

  it('does not sign for a key it does not hold', async () => {
    const h = harness();
    h.keyring.replace([]);
    expect(await handleAgentMessage(h.deps, h.signBody())).toEqual(failure());
  });

  it('serves nothing while locked and says so', async () => {
    const h = harness();
    h.state.unlocked = false;
    expect(await handleAgentMessage(h.deps, hex('0b'))).toEqual(identitiesAnswer([]));
    expect(await handleAgentMessage(h.deps, h.signBody())).toEqual(failure());
    expect(h.state.locked).toBe(2);
    expect(h.log).toEqual([]);
  });

  it('asks before signing when the key requires confirmation; a denial means no signature', async () => {
    const h = harness();
    h.key.confirm = true;
    h.state.answer = false;
    expect(await handleAgentMessage(h.deps, h.signBody())).toEqual(failure());
    expect(h.state.confirms).toBe(1);
    expect(h.log[0]).toMatch(/DENIED/);
    expect(h.state.touched).toBe(0);

    h.state.answer = true;
    const ok = await handleAgentMessage(h.deps, h.signBody());
    expect(ok[4]).toBe(MSG.SIGN_RESPONSE);
    expect(h.state.confirms).toBe(2);
  });

  it('does not ask when confirmation is off', async () => {
    const h = harness();
    await handleAgentMessage(h.deps, h.signBody());
    expect(h.state.confirms).toBe(0);
  });

  it('refuses a legacy RSA request without crashing', async () => {
    const parsed = fixture('rsa3072');
    const h = harness();
    const rsa = agentKey(parsed);
    h.keyring.replace([rsa]);
    const body = Buffer.concat([
      Buffer.from([13]),
      Buffer.from(sshString(rsa.blob)),
      Buffer.from(sshString(Buffer.from('x'))),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(await handleAgentMessage(h.deps, body)).toEqual(failure());
  });
});

// ------------------------------------------------------------------ doctor + install

const probes = (over: Partial<Probes> = {}): Probes => ({
  pipeBusy: async () => false,
  voultAgentRunning: async () => true,
  builtinService: async () => ({ status: 'Stopped', startType: 'Disabled' }),
  sshVersion: async () => 'OpenSSH_for_Windows_9.5p2, LibreSSL 3.8.2',
  sshPath: async () => 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
  env: {},
  ...over,
});

describe('agent doctor', () => {
  it('is all green on a healthy setup', async () => {
    const checks = await diagnose(probes());
    expect(checks.every((c) => c.ok && !c.warn)).toBe(true);
  });

  it('explains how to free the pipe from the built-in agent', async () => {
    const checks = await diagnose(
      probes({
        voultAgentRunning: async () => false,
        pipeBusy: async () => true,
        builtinService: async () => ({ status: 'Running', startType: 'Automatic' }),
      }),
    );
    const bad = checks.filter((c) => !c.ok);
    expect(bad.map((c) => c.name)).toEqual(['Voult agent', 'Windows ssh-agent service']);
    expect(bad.every((c) => c.fix === FIX_BUILTIN_AGENT)).toBe(true);
    expect(FIX_BUILTIN_AGENT).toBe(
      'Open PowerShell as Administrator and run:  Stop-Service ssh-agent; Set-Service ssh-agent -StartupType Disabled',
    );
  });

  it('tells you to start the agent when nothing is running', async () => {
    const [c] = await diagnose(probes({ voultAgentRunning: async () => false }));
    expect(c).toMatchObject({ ok: false });
    expect(c!.fix).toMatch(/voult agent/);
  });

  it('warns about a service that could start later, old ssh, Git ssh and SSH_AUTH_SOCK', async () => {
    const checks = await diagnose(
      probes({
        builtinService: async () => ({ status: 'Stopped', startType: 'Automatic' }),
        sshVersion: async () => 'OpenSSH_for_Windows_8.1p1, LibreSSL 3.0.2',
        sshPath: async () => 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
        env: { SSH_AUTH_SOCK: '/tmp/other.sock' },
      }),
    );
    expect(checks.filter((c) => c.warn).map((c) => c.name)).toEqual([
      'Windows ssh-agent service',
      'OpenSSH client',
      'ssh on PATH',
      'SSH_AUTH_SOCK',
    ]);
  });

  it('reports a missing client and an unknown service state', async () => {
    const checks = await diagnose(
      probes({ sshVersion: async () => null, builtinService: async () => null }),
    );
    expect(checks.find((c) => c.name === 'OpenSSH client')).toMatchObject({ ok: false });
    expect(checks.find((c) => c.name === 'Windows ssh-agent service')?.message).toMatch(
      /Not installed/,
    );
  });

  it('parses ssh versions', () => {
    expect(parseSshVersion('OpenSSH_for_Windows_9.5p2, LibreSSL')).toEqual([9, 5]);
    expect(parseSshVersion('OpenSSH_8.1p1')).toEqual([8, 1]);
    expect(parseSshVersion('nonsense')).toBeNull();
    expect(supportsAskpassForce([8, 4])).toBe(true);
    expect(supportsAskpassForce([8, 3])).toBe(false);
    expect(supportsAskpassForce([10, 0])).toBe(true);
    expect(supportsAskpassForce(null)).toBe(false);
  });
});

describe('logon task', () => {
  it('registers a hidden, per-user task that runs the agent at logon', () => {
    const args = createTaskArgs('C:\\Program Files\\Voult\\voult.exe', ['agent', 'run']);
    expect(args.slice(0, 8)).toEqual([
      '/Create',
      '/TN',
      TASK_NAME,
      '/SC',
      'ONLOGON',
      '/RL',
      'LIMITED',
      '/F',
    ]);
    expect(args.at(-2)).toBe('/TR');
    expect(args.at(-1)).toBe(
      'conhost.exe --headless "C:\\Program Files\\Voult\\voult.exe" agent run',
    );
    expect(deleteTaskArgs()).toEqual(['/Delete', '/TN', TASK_NAME, '/F']);
  });
  it('quotes script paths with spaces', () => {
    expect(createTaskArgs('node.exe', ['C:\\a b\\main.js', 'agent']).at(-1)).toBe(
      'conhost.exe --headless "node.exe" "C:\\a b\\main.js" agent',
    );
  });
});
