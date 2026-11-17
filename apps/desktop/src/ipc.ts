import { randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

/** One request/response per connection, as a single line of JSON. */
export interface IpcRequest {
  /** Proves the caller can read the agent's runtime file (so it runs as the same Windows user). */
  token: string;
  cmd: string;
  args?: Record<string, unknown>;
}
export type IpcResponse =
  { ok: true; data?: unknown } | { ok: false; error: string; code?: string };

const MAX_LINE = 1_048_576;

export const newToken = (): string => randomBytes(32).toString('hex');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type Handler = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

export class IpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Listen on a named pipe (or any path/port `net` accepts) and answer authenticated requests. */
export function serveIpc(listen: string, token: string, handler: Handler): Promise<net.Server> {
  const server = net.createServer((sock) => {
    let buf = '';
    let answered = false;
    const reply = (r: IpcResponse) => {
      if (answered) return;
      answered = true;
      sock.end(JSON.stringify(r) + '\n');
    };
    sock.setEncoding('utf8');
    sock.setTimeout(120_000, () => sock.destroy());
    sock.on('error', () => undefined);
    sock.on('data', (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_LINE) return reply({ ok: false, error: 'request too large' });
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let req: IpcRequest;
      try {
        req = JSON.parse(buf.slice(0, nl)) as IpcRequest;
      } catch {
        return reply({ ok: false, error: 'bad request' });
      }
      if (typeof req.token !== 'string' || !safeEqual(req.token, token)) {
        return reply({ ok: false, error: 'not authorised', code: 'unauthorised' });
      }
      handler(String(req.cmd), req.args ?? {}).then(
        (data) => reply({ ok: true, data }),
        (e: unknown) =>
          reply({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            code: e instanceof IpcError ? e.code : undefined,
          }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listen, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** Send one request; rejects with `IpcError` on a failure response, or a plain Error if unreachable. */
export function callIpc<T = unknown>(
  listen: string,
  req: IpcRequest,
  timeoutMs = 120_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(listen);
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(timeoutMs, () => {
      sock.destroy();
      reject(new Error('The Voult agent did not answer in time.'));
    });
    sock.on('error', (e) => reject(e));
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    sock.on('data', (c: string) => (buf += c));
    sock.on('end', () => {
      try {
        const r = JSON.parse(buf) as IpcResponse;
        if (r.ok) resolve(r.data as T);
        else reject(new IpcError(r.error, r.code));
      } catch {
        reject(new Error('Bad answer from the Voult agent.'));
      }
    });
  });
}
