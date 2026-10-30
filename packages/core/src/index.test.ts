import { describe, expect, it } from 'vitest';
import { VOULT_FORMAT_VERSION } from './index';

describe('core', () => {
  it('exposes the format version', () => {
    expect(VOULT_FORMAT_VERSION).toBe(1);
  });
});
