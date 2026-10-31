// Release helpers used by .github/workflows/release.yml (and runnable locally).
//   node scripts/release-metadata.mjs set-version 1.2.3
//   node scripts/release-metadata.mjs firefox-updates 1.2.3 <xpi file name> <sha256> > updates.json
import { readFileSync, writeFileSync } from 'node:fs';

const [cmd, version, ...rest] = process.argv.slice(2);
const SEMVER = /^\d+\.\d+\.\d+$/;
if (!version || !SEMVER.test(version)) {
  console.error('usage: release-metadata.mjs <set-version|firefox-updates> <x.y.z> [...]');
  process.exit(1);
}

if (cmd === 'set-version') {
  const [major, minor, patch] = version.split('.').map(Number);
  for (const file of [
    'package.json',
    'apps/extension/package.json',
    'apps/mobile/package.json',
    'apps/server/package.json',
  ]) {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    j.version = version;
    writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
  }
  const app = JSON.parse(readFileSync('apps/mobile/app.json', 'utf8'));
  app.expo.version = version;
  app.expo.android.versionCode = major * 10000 + minor * 100 + patch;
  writeFileSync('apps/mobile/app.json', JSON.stringify(app, null, 2) + '\n');
  console.log(`versionCode ${app.expo.android.versionCode}`);
} else if (cmd === 'firefox-updates') {
  const [xpi, sha256] = rest;
  if (!xpi || !sha256) throw new Error('xpi file name and sha256 required');
  const url = `https://github.com/fmgoliveira/voult/releases/download/v${version}/${xpi}`;
  const manifest = {
    addons: {
      'voult@franciscoliveira.com': {
        updates: [{ version, update_link: url, update_hash: `sha256:${sha256}` }],
      },
    },
  };
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(1);
}
