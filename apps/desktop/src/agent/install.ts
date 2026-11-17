import { execFile } from 'node:child_process';

export const TASK_NAME = 'Voult SSH agent';

/** Quote one argument for the single `/TR` command line Task Scheduler stores. */
const q = (s: string) => `"${s.replace(/"/g, '')}"`;

/**
 * The `schtasks` arguments that register the agent to run at logon. `conhost --headless` runs the
 * console program without a window.
 */
export function createTaskArgs(command: string, args: string[]): string[] {
  const run = [q(command), ...args.map((a) => (/\s/.test(a) ? q(a) : a))].join(' ');
  return [
    '/Create',
    '/TN',
    TASK_NAME,
    '/SC',
    'ONLOGON',
    '/RL',
    'LIMITED',
    '/F',
    '/TR',
    `conhost.exe --headless ${run}`,
  ];
}

export const deleteTaskArgs = (): string[] => ['/Delete', '/TN', TASK_NAME, '/F'];

const schtasks = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('schtasks.exe', args, { windowsHide: true }, (e, out, err) =>
      e
        ? reject(new Error((String(err) || String(out) || e.message).trim()))
        : resolve(String(out)),
    );
  });

export const installTask = (command: string, args: string[]) =>
  schtasks(createTaskArgs(command, args));
export const uninstallTask = () => schtasks(deleteTaskArgs());
