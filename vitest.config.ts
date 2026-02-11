import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/characterization/**/*.test.ts'],
    testTimeout: 30000,
    snapshotSerializers: [],
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'lib'),
      '@tests': path.resolve(__dirname, 'tests'),
    },
  },
});
