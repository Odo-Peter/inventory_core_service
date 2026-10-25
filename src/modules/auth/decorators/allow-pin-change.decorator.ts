import { SetMetadata } from '@nestjs/common';

export const ALLOW_PIN_CHANGE_KEY = 'allow_pin_change';

export const AllowPinChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PIN_CHANGE_KEY, true);
