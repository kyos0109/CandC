import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'], testTimeout: 5_000, hookTimeout: 5_000,
    coverage: { provider: 'v8', include: ['src/**/*.ts', 'web/**/*.ts', 'web/**/*.tsx'], exclude: ['src/generated/**'],
      reportsDirectory: '.cache/coverage', reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 77, statements: 66, functions: 53, branches: 60 } },
  },
});
