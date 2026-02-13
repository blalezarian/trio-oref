import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/characterization/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/legacy/**/*.test.ts'],
    testTimeout: 30000,
    snapshotSerializers: [],
    coverage: {
      provider: 'v8',
      include: [
        'src/determine-basal/**/*.ts',
        'src/iob/**/*.ts',
        'src/meal/**/*.ts',
        'src/profile/**/*.ts',
        'src/autosens/**/*.ts',
        'src/cob/**/*.ts',
        'src/glucose/**/*.ts',
        'src/set-temp-basal/**/*.ts',
        'src/bolus/**/*.ts',
        'src/utils/**/*.ts',
        'src/shared/**/*.ts',
        'src/autotune-prep/**/*.ts',
        'src/autotune/**/*.ts',
      ],
      reporter: ['text', 'text-summary', 'html', 'json'],
      reportsDirectory: 'coverage',
    },
  },
});
