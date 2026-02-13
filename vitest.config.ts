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
        'src/determine-basal/determine-basal.{js,ts}',
        'src/determine-basal/cob.{js,ts}',
        'src/determine-basal/autosens.{js,ts}',
        'src/iob/**/*.{js,ts}',
        'src/meal/**/*.{js,ts}',
        'src/profile/**/*.{js,ts}',
        'src/glucose-get-last.{js,ts}',
        'src/basal-set-temp.{js,ts}',
        'src/round-basal.{js,ts}',
        'src/percentile.{js,ts}',
        'src/medtronic-clock.{js,ts}',
        'src/glucose-stats.{js,ts}',
        'src/calc-glucose-stats.{js,ts}',
        'src/bolus.{js,ts}',
        'src/with-raw-glucose.{js,ts}',
        'src/autotune-prep/**/*.{js,ts}',
        'src/autotune/**/*.{js,ts}',
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
