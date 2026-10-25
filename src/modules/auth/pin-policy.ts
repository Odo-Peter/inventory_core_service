import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import type { StaffRole } from '../../generated/prisma/enums.js';
import { AppException } from '../../common/errors/app.exception.js';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PRIVILEGED_PIN_LENGTH = 6;
export const PIN_PATTERN = /^\d{4,6}$/;

export function isPinFormatValid(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) {
    return true;
  }

  let ascending = true;
  let descending = true;

  for (let index = 1; index < pin.length; index += 1) {
    const difference = Number(pin[index]) - Number(pin[index - 1]);
    if (difference !== 1) {
      ascending = false;
    }
    if (difference !== -1) {
      descending = false;
    }
  }

  return ascending || descending;
}

export function hasValidPinLength(pin: string, role: StaffRole): boolean {
  if (role !== 'cashier') {
    return pin.length === PRIVILEGED_PIN_LENGTH;
  }
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

@Injectable()
export class PinPolicy {
  validate(pin: string, role: StaffRole): void {
    if (!isPinFormatValid(pin) || !hasValidPinLength(pin, role)) {
      throw new AppException(
        400,
        'weak_pin',
        role === 'cashier'
          ? 'PIN must be 4 to 6 digits'
          : 'Manager and admin PINs must be exactly 6 digits',
      );
    }

    if (isWeakPin(pin)) {
      throw new AppException(
        400,
        'weak_pin',
        'PIN must not use repeated or sequential digits',
      );
    }
  }

  generate(): string {
    let pin = '';

    do {
      pin = randomInt(0, 1_000_000)
        .toString()
        .padStart(PRIVILEGED_PIN_LENGTH, '0');
    } while (isWeakPin(pin));

    return pin;
  }
}
