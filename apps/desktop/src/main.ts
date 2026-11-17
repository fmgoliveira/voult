import { runCli, defaultDeps } from './cli';
import { resolvePaths } from './paths';

const paths = resolvePaths();
runCli(process.argv.slice(2), defaultDeps(paths)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
