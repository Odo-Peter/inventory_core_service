import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Reads ONLY .env.test (never .env), so dev values cannot leak into tests*/
export function loadTestEnv(): Record<string, string> {
  return parseEnv(readFileSync('.env.test', 'utf8')) as Record<string, string>;
}
