import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The end-to-end tests copy fixture trees and spawn a real Node process per case, which
    // exceeds vitest's 5s default on a cold Windows runner.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
