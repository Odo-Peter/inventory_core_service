import { execSync } from 'node:child_process';
import { loadTestEnv } from './test-env.js';
import { assertTestDatabase } from './assert-test-db.js';

export default function setup(): void {
  // globalSetup runs in the main process, where `test.env` is not applied yet.
  const env = { ...process.env, ...loadTestEnv() };
  assertTestDatabase(env.DATABASE_URL);
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
}
