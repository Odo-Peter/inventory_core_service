import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { hash, verify } from 'argon2';

import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { PIN_HASH_OPTIONS } from './pin-hashing.constants.js';
import { applyPinPepper } from './pin-pepper.js';

@Injectable()
export class PinHasherService implements OnModuleInit {
  dummyHash = '';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-pin-timing-equalizer');
  }

  async hash(pin: string): Promise<string> {
    const peppered = applyPinPepper(pin, this.config.pinPepper);
    return hash(peppered, PIN_HASH_OPTIONS);
  }

  async verify(pinHash: string, pin: string): Promise<boolean> {
    const peppered = applyPinPepper(pin, this.config.pinPepper);

    try {
      return await verify(pinHash, peppered);
    } catch {
      return false;
    }
  }
}
