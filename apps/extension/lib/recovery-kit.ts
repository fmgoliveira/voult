import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** One-page printable recovery kit. Contains the secret key, so it must be stored offline. */
export async function buildRecoveryKitPdf(opts: {
  email: string;
  serverUrl: string;
  recoverySecret: string;
  createdAt?: Date;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const ink = rgb(0.08, 0.09, 0.1);
  const muted = rgb(0.35, 0.38, 0.44);

  let y = 780;
  const line = (
    text: string,
    o: { size?: number; f?: typeof font; color?: typeof ink; gap?: number } = {},
  ) => {
    page.drawText(text, { x: 56, y, size: o.size ?? 11, font: o.f ?? font, color: o.color ?? ink });
    y -= o.gap ?? 18;
  };

  line('Voult recovery kit', { size: 26, f: bold, gap: 34 });
  line(`Created ${(opts.createdAt ?? new Date()).toISOString().slice(0, 10)}`, {
    color: muted,
    gap: 30,
  });
  line('Account', { f: bold });
  line(opts.email);
  line(opts.serverUrl, { gap: 30 });
  line('Recovery secret key', { f: bold, gap: 26 });
  line(opts.recoverySecret, { size: 18, f: mono, gap: 34 });
  for (const t of [
    'If you forget your master password, this key together with your account can unlock',
    'your vault. Anyone who has it can too, so keep this page somewhere safe and offline.',
    '',
    'Voult cannot reset your master password. Without the password or this key your',
    'data cannot be recovered by anyone, including the server operator.',
  ]) {
    line(t, { color: muted, gap: 16 });
  }
  return doc.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/pdf'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
