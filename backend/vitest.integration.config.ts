import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./packages/adapters/test/support/integration-global-setup.ts'],
    include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
