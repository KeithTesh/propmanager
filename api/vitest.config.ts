// api/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'src/__tests__/'],
    },
    // Run tests sequentially — they share a test DB
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});