import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        // ResilientGrpcClient has many connection methods that require
        // real gRPC server for testing. Unit tests cover utilities 100%.
        // Integration tests (when enabled) provide full coverage.
        lines: 50,
        functions: 70,
        branches: 60,
        statements: 50,
      },
    },
    testTimeout: 10000,
  },
});
