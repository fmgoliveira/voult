import { defaultDeps, runCli } from './cli';
import { send } from './client';
import { resolvePaths } from './paths';
import { runAskpass } from './ssh/wrapper';

const paths = resolvePaths();
const token = process.env.VOULT_ASKPASS_TOKEN;

if (token && process.argv.length === 3) {
  // Started by ssh as SSH_ASKPASS: argv is just the prompt. Answer password prompts, refuse the rest.
  runAskpass(
    {
      send: (cmd, args) => send(paths, cmd, args ?? {}, { start: false }),
      write: (t) => process.stdout.write(t),
    },
    token,
    process.argv[2]!,
  ).then((code) => process.exit(code));
} else {
  runCli(process.argv.slice(2), defaultDeps(paths)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
