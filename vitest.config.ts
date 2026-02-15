import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/characterization/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/legacy/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/golden/**/*.test.ts', 'tests/bundle/**/*.test.ts'],
    testTimeout: 30000,
    snapshotSerializers: [],
    coverage: {
      provider: 'v8',
      include: [
        'src/determineBasal/**/*.ts',
        'src/iob/**/*.ts',
        'src/meal/**/*.ts',
        'src/profile/**/*.ts',
        'src/autosens/**/*.ts',
        'src/cob/**/*.ts',
        'src/glucose/**/*.ts',
        'src/setTempBasal/**/*.ts',
        'src/bolus/**/*.ts',
        'src/utils/**/*.ts',
        'src/shared/**/*.ts',
        'src/autotunePrep/**/*.ts',
        'src/autotune/**/*.ts',
      ],
      reporter: ['text', 'text-summary', 'html', 'json'],
      reportsDirectory: 'coverage',
    },
  },
});
