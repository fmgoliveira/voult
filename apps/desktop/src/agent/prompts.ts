import { spawn } from 'node:child_process';

const run = (script: string, stdin: string, timeoutMs: number): Promise<string | null> =>
  new Promise((resolve) => {
    let out = '';
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
    // The text shown goes in over stdin as JSON, so it is never parsed as script.
    child.stdin.end(stdin);
  });

const CONFIRM = `
Add-Type -AssemblyName System.Windows.Forms
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$r = [System.Windows.Forms.MessageBox]::Show($form, $p.message, 'Voult SSH agent', 'YesNo', 'Question', 'Button2')
[Console]::Out.Write($(if ($r -eq 'Yes') { 'yes' } else { 'no' }))
`;

/**
 * Ask the user to approve one signature. Anything but a clear "Yes" (No, closing the dialog,
 * a failure to show it, or running out of time) counts as a denial.
 */
export async function confirmSignature(
  keyTitle: string,
  fingerprint: string,
  timeoutSeconds: number,
): Promise<boolean> {
  const answer = await run(
    CONFIRM,
    JSON.stringify({
      message: `An SSH client wants to sign in with the key "${keyTitle}".\n${fingerprint}\n\nAllow it?`,
    }),
    Math.max(1, timeoutSeconds) * 1000,
  );
  return answer === 'yes';
}

const TOAST = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.ShowBalloonTip(6000, 'Voult', $p.message, [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Seconds 7
$n.Dispose()
`;

/** A Windows notification (balloon). Fire and forget. */
export function showToast(message: string): void {
  void run(TOAST, JSON.stringify({ message }), 15_000);
}
