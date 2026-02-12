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
        'lib/determine-basal/determine-basal.js',
        'lib/determine-basal/cob.js',
        'lib/determine-basal/autosens.js',
        'lib/iob/**/*.js',
        'lib/meal/**/*.js',
        'lib/profile/**/*.js',
        'lib/glucose-get-last.js',
        'lib/basal-set-temp.js',
        'lib/round-basal.js',
        'lib/percentile.js',
        'lib/medtronic-clock.js',
        'lib/glucose-stats.js',
        'lib/calc-glucose-stats.js',
        'lib/bolus.js',
        'lib/with-raw-glucose.js',
        'lib/autotune-prep/**/*.js',
        'lib/autotune/**/*.js',
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
