import { spawn } from 'node:child_process';

/** Windows DPAPI, CurrentUser scope: only this Windows user can open what it protects. */
export interface Dpapi {
  protect(data: Uint8Array): Promise<Uint8Array>;
  unprotect(data: Uint8Array): Promise<Uint8Array>;
}

const script = (op: 'Protect' | 'Unprotect') => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$out = [System.Security.Cryptography.ProtectedData]::${op}($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

function run(op: 'Protect' | 'Unprotect', data: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // The payload goes over stdin, never argv, so it is not visible in the process list.
    const encoded = Buffer.from(script(op), 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`DPAPI ${op} failed: ${err.trim().slice(0, 200)}`));
      else resolve(new Uint8Array(Buffer.from(out.trim(), 'base64')));
    });
    child.stdin.end(Buffer.from(data).toString('base64'));
  });
}

/** DPAPI through Windows PowerShell's `ProtectedData` (no native module to ship). */
export const windowsDpapi: Dpapi = {
  protect: (d) => run('Protect', d),
  unprotect: (d) => run('Unprotect', d),
};

/** Test stand-in: reversible, but NOT protection. */
export const fakeDpapi: Dpapi = {
  protect: async (d) => Uint8Array.from(d, (b) => b ^ 0x5a),
  unprotect: async (d) => Uint8Array.from(d, (b) => b ^ 0x5a),
};
