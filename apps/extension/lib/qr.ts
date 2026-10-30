import { parseOtpQr, type Totp } from '@voult/core';
import jsQR from 'jsqr';
import { browser } from 'wxt/browser';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decode a QR code from raw RGBA pixels; returns its text or null. */
export function decodeQr(img: Pixels): string | null {
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Decode, then interpret as otpauth:// or a Google Authenticator export. */
export function totpFromPixels(img: Pixels): Totp[] {
  const text = decodeQr(img);
  if (!text) throw new Error('No QR code found.');
  try {
    return parseOtpQr(text);
  } catch {
    throw new Error('That QR code is not a 2FA code.');
  }
}

async function toPixels(dataUrl: string, maxSide = 1800): Promise<Pixels> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Capture what the user currently sees in the active tab and look for a 2FA QR code in it. */
export async function scanActiveTab(): Promise<Totp[]> {
  const png = await browser.tabs.captureVisibleTab(undefined as never, { format: 'png' });
  return totpFromPixels(await toPixels(png));
}
