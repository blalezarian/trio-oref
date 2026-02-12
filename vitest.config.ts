import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/characterization/**/*.test.ts'],
    testTimeout: 30000,
    snapshotSerializers: [],
    coverage: {
      provider: 'v8',
      include: [
        'lib/determine-basal/determine-basal.{js,ts}',
        'lib/determine-basal/cob.{js,ts}',
        'lib/determine-basal/autosens.{js,ts}',
        'lib/iob/**/*.{js,ts}',
        'lib/meal/**/*.{js,ts}',
        'lib/profile/**/*.{js,ts}',
        'lib/glucose-get-last.{js,ts}',
        'lib/basal-set-temp.{js,ts}',
        'lib/round-basal.{js,ts}',
        'lib/percentile.{js,ts}',
        'lib/medtronic-clock.{js,ts}',
        'lib/glucose-stats.{js,ts}',
        'lib/calc-glucose-stats.{js,ts}',
        'lib/bolus.{js,ts}',
        'lib/with-raw-glucose.{js,ts}',
        'lib/autotune-prep/**/*.{js,ts}',
        'lib/autotune/**/*.{js,ts}',
      ],
      reporter: ['text', 'text-summary', 'html', 'json'],
      reportsDirectory: 'coverage',
    },
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'lib'),
      '@tests': path.resolve(__dirname, 'tests'),
    },
  },
});
