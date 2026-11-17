import { startDaemon } from './daemon';
import { windowsDpapi } from './dpapi';
import type { Paths } from './paths';

/** Start the agent in this process and keep running until Ctrl+C / the process is stopped. */
export async function runAgent(paths: Paths): Promise<void> {
  let daemon;
  try {
    daemon = await startDaemon({
      paths,
      dpapi: windowsDpapi,
      syncEveryMs: 5 * 60_000,
      watchSession: true,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'EADDRINUSE') {
      throw new Error('The Voult agent is already running.', { cause: e });
    }
    throw e;
  }
  console.error('Voult agent running. Press Ctrl+C to stop.');
  const stop = () => void daemon.stop().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise<never>(() => undefined);
}
