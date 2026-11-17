import { appendFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AgentKey, Keyring } from '../keyring';
import {
  failure,
  FrameReader,
  identitiesAnswer,
  parseRequest,
  ProtocolError,
  signResponse,
} from './protocol';
import { signWithKey } from './sign';

export interface AgentDeps {
  keyring: Keyring;
  isUnlocked: () => boolean;
  /** Counts as activity (keeps the idle timer from locking while keys are in use). */
  touch: () => void;
  /** Called when a client asks for keys while the vault is locked. */
  notifyLocked: () => void;
  /** Ask the user; resolves false on denial or timeout. */
  confirm: (key: AgentKey) => Promise<boolean>;
  /** Append a line to the usage log (no secrets). */
  logUse?: (line: string) => void;
  now?: () => Date;
}

/** Answer one decoded request. Pure enough to test without a socket. */
export async function handleAgentMessage(deps: AgentDeps, body: Uint8Array): Promise<Uint8Array> {
  let req;
  try {
    req = parseRequest(body);
  } catch {
    return failure();
  }
  if (req.type === 'unsupported') return failure(); // add/remove identity, lock, extensions…
  if (!deps.isUnlocked()) {
    deps.notifyLocked();
    return req.type === 'identities' ? identitiesAnswer([]) : failure();
  }
  if (req.type === 'identities') {
    return identitiesAnswer(deps.keyring.list().map((k) => ({ blob: k.blob, comment: k.title })));
  }
  const key = deps.keyring.find(req.keyBlob);
  if (!key) return failure();
  if (key.confirm && !(await deps.confirm(key))) {
    deps.logUse?.(
      `${(deps.now?.() ?? new Date()).toISOString()} DENIED ${key.fingerprint} client=unknown`,
    );
    return failure();
  }
  try {
    const sig = signWithKey(key, req.data, req.flags);
    deps.touch();
    deps.logUse?.(
      `${(deps.now?.() ?? new Date()).toISOString()} SIGN ${key.fingerprint} client=unknown`,
    );
    return signResponse(sig);
  } catch {
    return failure();
  }
}

/** Listen as an SSH agent on `pipe` (a Windows named pipe, or a socket path elsewhere). */
export function startAgentServer(deps: AgentDeps, pipe: string): Promise<net.Server> {
  const server = net.createServer((sock) => {
    const reader = new FrameReader();
    // Requests on one connection are answered strictly in order.
    let chain: Promise<void> = Promise.resolve();
    sock.on('error', () => undefined);
    sock.on('data', (chunk) => {
      let bodies: Uint8Array[];
      try {
        bodies = reader.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      } catch (e) {
        if (e instanceof ProtocolError) sock.destroy();
        return;
      }
      for (const body of bodies) {
        chain = chain
          .then(() => handleAgentMessage(deps, body))
          .then((res) => {
            sock.write(res);
          })
          .catch(() => void sock.destroy());
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** A usage logger appending to a file (created with its folder if needed). */
export function fileUsageLog(file: string): (line: string) => void {
  mkdirSync(path.dirname(file), { recursive: true });
  return (line) => {
    try {
      appendFileSync(file, line + '\n');
    } catch {
      /* logging must never break signing */
    }
  };
}
