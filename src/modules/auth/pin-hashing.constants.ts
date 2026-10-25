import { argon2id, type HashOptions } from 'argon2';

export const PIN_HASH_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
