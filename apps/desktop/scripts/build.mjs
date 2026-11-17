// Bundles the CLI into one file, and with --exe wraps it in a Node single-executable (voult.exe).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const exe = process.argv.includes('--exe');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.ts')],
  outfile: path.join(dist, 'voult.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
});

if (exe) {
  const blob = path.join(dist, 'sea-prep.blob');
  const config = path.join(dist, 'sea-config.json');
  writeFileSync(
    config,
    JSON.stringify({
      main: path.join(dist, 'voult.cjs'),
      output: blob,
      disableExperimentalSEAWarning: true,
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

  const out = path.join(dist, process.platform === 'win32' ? 'voult.exe' : 'voult');
  copyFileSync(process.execPath, out);
  const postject = path.join(root, 'node_modules/postject/dist/cli.js');
  const resolved = (await import('node:module')).createRequire(import.meta.url).resolve(
    'postject/dist/cli.js',
  );
  execFileSync(
    process.execPath,
    [
      resolved ?? postject,
      out,
      'NODE_SEA_BLOB',
      blob,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ],
    { stdio: 'inherit' },
  );
  console.log(`Built ${out}`);
}
