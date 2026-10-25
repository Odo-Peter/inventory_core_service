import { createHmac } from 'node:crypto';

export function applyPinPepper(pin: string, pepper: string): string {
  return createHmac('sha256', pepper).update(pin, 'utf8').digest('hex');
}
