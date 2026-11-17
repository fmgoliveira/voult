import { spawn, type ChildProcess } from 'node:child_process';

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Register-ObjectEvent -InputObject ([Microsoft.Win32.SystemEvents]) -EventName SessionSwitch -SourceIdentifier S | Out-Null
Register-ObjectEvent -InputObject ([Microsoft.Win32.SystemEvents]) -EventName PowerModeChanged -SourceIdentifier P | Out-Null
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($true) {
  $e = Wait-Event
  if ($e.SourceIdentifier -eq 'S') { [Console]::Out.WriteLine('session:' + $e.SourceEventArgs.Reason) }
  else { [Console]::Out.WriteLine('power:' + $e.SourceEventArgs.Mode) }
  [Console]::Out.Flush()
  Remove-Event -EventIdentifier $e.EventIdentifier
}
`;

/** Whether a line from the watcher means the user stepped away (lock, switch user, sleep). */
export function isLockEvent(line: string): boolean {
  const l = line.trim();
  return (
    /^session:(SessionLock|ConsoleDisconnect|RemoteDisconnect|SessionLogoff)$/.test(l) ||
    l === 'power:Suspend'
  );
}

/**
 * Runs a small hidden PowerShell that reports Windows session lock and sleep, and calls
 * `onLock` for each. Returns a function that stops it. Best effort: if PowerShell cannot be
 * started the idle timer still locks the vault.
 */
export function watchSession(onLock: () => void): () => void {
  let child: ChildProcess | undefined;
  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(SCRIPT, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return () => undefined;
  }
  let buf = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (c: string) => {
    buf += c;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (isLockEvent(line)) onLock();
    }
  });
  child.on('error', () => undefined);
  return () => {
    child?.kill();
  };
}
