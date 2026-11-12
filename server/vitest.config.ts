import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/db/global-setup.ts'],
    // All DB test files share one test database, so run files one after another.
    fileParallelism: false,
  },
});
