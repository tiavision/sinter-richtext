import { defineConfig } from 'vitest/config';

// The tests run against the sinter installed beside the package (`file:../sinter`: build it first).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    env: { SINTER_STRICT: '' },
  },
});
