import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/characterization/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    testTimeout: 30000,
    snapshotSerializers: [],
    coverage: {
      provider: 'v8',
      include: [
        'src/determine-basal/**/*.{js,ts}',
        'src/iob/**/*.{js,ts}',
        'src/meal/**/*.{js,ts}',
        'src/profile/**/*.{js,ts}',
        'src/autosens/**/*.{js,ts}',
        'src/cob/**/*.{js,ts}',
        'src/glucose/**/*.{js,ts}',
        'src/basal/**/*.{js,ts}',
        'src/bolus/**/*.{js,ts}',
        'src/utils/**/*.{js,ts}',
        'src/shared/**/*.{js,ts}',
        'src/autotune-prep/**/*.{js,ts}',
        'src/autotune/**/*.{js,ts}',
        'src/deprecated/**/*.{js,ts}',
      ],
      reporter: ['text', 'text-summary', 'html', 'json'],
      reportsDirectory: 'coverage',
    },
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src'),
      '@tests': path.resolve(__dirname, 'tests'),
    },
  },
});
