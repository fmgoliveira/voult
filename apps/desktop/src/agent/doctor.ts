import { execFile } from 'node:child_process';
import net from 'node:net';

export const FIX_BUILTIN_AGENT =
  'Open PowerShell as Administrator and run:  Stop-Service ssh-agent; Set-Service ssh-agent -StartupType Disabled';

export interface Probes {
  /** Something is already listening on the OpenSSH agent pipe. */
  pipeBusy(): Promise<boolean>;
  /** Voult's own agent is running (answers on its control pipe). */
  voultAgentRunning(): Promise<boolean>;
  /** State of the Windows `ssh-agent` service, or null if it is not installed. */
  builtinService(): Promise<{ status: string; startType: string } | null>;
  /** Output of `ssh -V` for the ssh that would run, or null if there is none. */
  sshVersion(): Promise<string | null>;
  /** Full path of the `ssh` found first on PATH. */
  sshPath(): Promise<string | null>;
  env: Record<string, string | undefined>;
}

export interface Check {
  name: string;
  ok: boolean;
  /** Not a failure, but worth knowing. */
  warn?: boolean;
  message: string;
  fix?: string;
}

/** Parse `OpenSSH_for_Windows_9.5p2` / `OpenSSH_8.1p1` into [major, minor]. */
export function parseSshVersion(text: string): [number, number] | null {
  const m = /OpenSSH[_a-z]*?_(\d+)\.(\d+)/i.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export const supportsAskpassForce = (v: [number, number] | null): boolean =>
  !!v && (v[0] > 8 || (v[0] === 8 && v[1] >= 4));

export async function diagnose(p: Probes): Promise<Check[]> {
  const checks: Check[] = [];
  const [busy, ours, svc, ver, sshPath] = await Promise.all([
    p.pipeBusy(),
    p.voultAgentRunning(),
    p.builtinService(),
    p.sshVersion(),
    p.sshPath(),
  ]);

  if (ours) {
    checks.push({ name: 'Voult agent', ok: true, message: 'The Voult agent is running.' });
  } else if (busy) {
    checks.push({
      name: 'Voult agent',
      ok: false,
      message: 'Another program (probably the Windows OpenSSH agent) holds the agent pipe.',
      fix: FIX_BUILTIN_AGENT,
    });
  } else {
    checks.push({
      name: 'Voult agent',
      ok: false,
      message: 'The Voult agent is not running.',
      fix: 'Run `voult agent` in a terminal, or `voult agent install` to start it at logon.',
    });
  }

  if (!svc) {
    checks.push({ name: 'Windows ssh-agent service', ok: true, message: 'Not installed.' });
  } else if (/running/i.test(svc.status)) {
    checks.push({
      name: 'Windows ssh-agent service',
      ok: false,
      message: 'The built-in ssh-agent service is running and will hold the agent pipe.',
      fix: FIX_BUILTIN_AGENT,
    });
  } else if (/auto|manual/i.test(svc.startType)) {
    checks.push({
      name: 'Windows ssh-agent service',
      ok: true,
      warn: true,
      message: `Stopped, but set to start ${svc.startType.toLowerCase()}: it may take the pipe later.`,
      fix: 'Set-Service ssh-agent -StartupType Disabled   (as Administrator)',
    });
  } else {
    checks.push({ name: 'Windows ssh-agent service', ok: true, message: 'Stopped and disabled.' });
  }

  if (!ver) {
    checks.push({
      name: 'OpenSSH client',
      ok: false,
      message: 'No ssh found.',
      fix: 'Install it: winget install Microsoft.OpenSSH.Preview',
    });
  } else {
    const v = parseSshVersion(ver);
    checks.push({
      name: 'OpenSSH client',
      ok: true,
      warn: !supportsAskpassForce(v),
      message: supportsAskpassForce(v)
        ? ver
        : `${ver}: password hosts (voult ssh) need OpenSSH 8.4 or newer.`,
      fix: supportsAskpassForce(v)
        ? undefined
        : 'Install the current Win32-OpenSSH: winget install Microsoft.OpenSSH.Preview',
    });
  }

  if (sshPath && /[\\/]Git[\\/]/i.test(sshPath)) {
    checks.push({
      name: 'ssh on PATH',
      ok: true,
      warn: true,
      message: `${sshPath} is Git for Windows' ssh, which does not use the Windows agent pipe.`,
      fix: 'Run ssh from PowerShell/cmd, or put C:\\Windows\\System32\\OpenSSH first on PATH.',
    });
  }

  const sock = p.env.SSH_AUTH_SOCK;
  if (sock && !/openssh-ssh-agent/.test(sock)) {
    checks.push({
      name: 'SSH_AUTH_SOCK',
      ok: true,
      warn: true,
      message: `SSH_AUTH_SOCK is set to ${sock}; ssh will use that agent instead of Voult.`,
      fix: 'Remove the SSH_AUTH_SOCK environment variable.',
    });
  }
  return checks;
}

// ------------------------------------------------------------------ real probes

const exec = (file: string, args: string[]): Promise<{ out: string; err: string; ok: boolean }> =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (e, out, err) =>
      resolve({ out: String(out), err: String(err), ok: !e }),
    );
  });

export const canConnect = (pipe: string): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect(pipe);
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(2000, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });

export function realProbes(agentPipe: string, voultRunning: () => Promise<boolean>): Probes {
  return {
    pipeBusy: () => canConnect(agentPipe),
    voultAgentRunning: voultRunning,
    async builtinService() {
      const r = await exec('powershell.exe', [
        '-NoProfile',
        '-Command',
        '$s = Get-Service ssh-agent -ErrorAction SilentlyContinue; if ($s) { "$($s.Status)|$($s.StartType)" }',
      ]);
      const [status, startType] = r.out.trim().split('|');
      return status && startType ? { status, startType } : null;
    },
    async sshVersion() {
      const r = await exec(await resolveSsh(), ['-V']);
      const text = (r.err || r.out).trim();
      return text || null;
    },
    async sshPath() {
      const r = await exec('where.exe', ['ssh']);
      return r.out.split(/\r?\n/)[0]?.trim() || null;
    },
    env: process.env,
  };
}

/** The ssh to run: Windows' own OpenSSH when present (it speaks to the agent pipe), else PATH. */
export async function resolveSsh(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.VOULT_SSH) return env.VOULT_SSH;
  const { existsSync } = await import('node:fs');
  const win = `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\OpenSSH\\ssh.exe`;
  return existsSync(win) ? win : 'ssh';
}
