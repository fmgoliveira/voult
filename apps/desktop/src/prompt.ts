/** Read one line from stdin without echoing it (a master password). */
export async function promptHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) return readLineFromStdin();
  stderr.write(question);
  return new Promise((resolve, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled.'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/** First line of piped stdin (for `--password-stdin` and scripts). */
export async function readLineFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) {
    chunks.push(Buffer.from(c));
    if (Buffer.concat(chunks).includes(0x0a)) break;
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}
