import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './test/setup/test-env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    globalSetup: ['./test/setup/global-setup.ts'],
    env: {
      ...loadTestEnv(),
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
