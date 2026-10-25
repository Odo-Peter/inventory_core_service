import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../config/app-config.js';
import { PinHasherService } from './pin-hasher.service.js';

const config = {
  pinPepper: 'test-pin-pepper-0123456789',
} as AppConfig;

describe('PinHasherService', () => {
  const hasher = new PinHasherService(config);

  it('matches the original PIN', async () => {
    const pinHash = await hasher.hash('246810');
    await expect(hasher.verify(pinHash, '246810')).resolves.toBe(true);
  });

  it('rejects a different PIN', async () => {
    const pinHash = await hasher.hash('246810');
    await expect(hasher.verify(pinHash, '135791')).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    const first = await hasher.hash('246810');
    const second = await hasher.hash('246810');

    expect(first).not.toBe(second);
    await expect(hasher.verify(first, '246810')).resolves.toBe(true);
    await expect(hasher.verify(second, '246810')).resolves.toBe(true);
  });

  it('rejects a hash made with a different pepper', async () => {
    const otherHasher = new PinHasherService({
      pinPepper: 'another-pepper-0123456789',
    } as AppConfig);
    const pinHash = await otherHasher.hash('246810');

    await expect(hasher.verify(pinHash, '246810')).resolves.toBe(false);
  });
});
