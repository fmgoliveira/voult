import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { totpFromPixels } from '../lib/qr';

/** Rasterise a QR matrix to RGBA the way a screenshot would look (with quiet zone + scale). */
function render(text: string, scale = 6, invert = false) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dark = qr.modules.get(x, y) === 1;
      const v = dark ? 0 : 255;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
        }
      }
    }
  }
  if (invert)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i]!;
      data[i + 1] = 255 - data[i + 1]!;
      data[i + 2] = 255 - data[i + 2]!;
    }
  return { data, width: size, height: size };
}

describe('QR capture', () => {
  it('reads an otpauth:// QR', () => {
    const [t] = totpFromPixels(
      render('otpauth://totp/GitHub:octo?secret=JBSWY3DPEHPK3PXP&issuer=GitHub'),
    );
    expect(t).toMatchObject({ issuer: 'GitHub', account: 'octo', secret: 'JBSWY3DPEHPK3PXP' });
  });
  it('reads an inverted (dark-mode) QR', () => {
    expect(totpFromPixels(render('otpauth://totp/x?secret=ABCDEFGH', 6, true))).toHaveLength(1);
  });
  it('rejects blank images and non-2FA codes', () => {
    const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 };
    expect(() => totpFromPixels(blank)).toThrow('No QR code');
    expect(() => totpFromPixels(render('https://example.com'))).toThrow('not a 2FA');
  });
});
