/**
 * Characterization tests for iob/total.js
 *
 * Tests the IOB summation function that aggregates contributions from
 * all active treatments at a given point in time. This is the core
 * function that sums individual insulin curve calculations.
 */

import { describe, it, expect } from 'vitest';
import { iobTotal } from '../../../src/iob/sumIob';
import { iobCalc } from '../../../src/iob/calculateSingleIob';

const NOW = new Date('2025-01-15T12:00:00.000Z');

function makeTreatment(insulin: number, minsAgo: number) {
  return {
    insulin,
    date: NOW.getTime() - minsAgo * 60_000,
    started_at: new Date(NOW.getTime() - minsAgo * 60_000).toISOString(),
  };
}

function makeOpts(
  treatments: ReturnType<typeof makeTreatment>[],
  profileOverrides: Record<string, unknown> = {},
) {
  return {
    treatments,
    profile: {
      dia: 5,
      curve: 'rapid-acting' as const,
      useCustomPeakTime: false,
      insulinPeakTime: 75,
      ...profileOverrides,
    },
    calculate: iobCalc,
  };
}

/** Round IOB output fields for stable snapshots */
function normalize(result: Record<string, unknown>) {
  const out = { ...result };
  // Replace time with stable value
  out.time = '[TIME]';
  return out;
}

describe('iob/total characterization tests', () => {
  describe('single bolus treatments', () => {
    it('1U bolus just given (0m ago)', () => {
      const opts = makeOpts([makeTreatment(1, 0)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 30m ago', () => {
      const opts = makeOpts([makeTreatment(1, 30)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 60m ago', () => {
      const opts = makeOpts([makeTreatment(1, 60)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 120m ago', () => {
      const opts = makeOpts([makeTreatment(1, 120)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 240m ago', () => {
      const opts = makeOpts([makeTreatment(1, 240)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 300m ago (at DIA boundary)', () => {
      const opts = makeOpts([makeTreatment(1, 300)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('1U bolus 360m ago (past DIA)', () => {
      const opts = makeOpts([makeTreatment(1, 360)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('2U bolus 60m ago', () => {
      const opts = makeOpts([makeTreatment(2, 60)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('5U bolus 30m ago', () => {
      const opts = makeOpts([makeTreatment(5, 30)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });

  describe('multiple bolus treatments', () => {
    it('two 1U boluses at 30m and 60m ago', () => {
      const opts = makeOpts([makeTreatment(1, 30), makeTreatment(1, 60)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('three boluses stacked: 2U@10m, 1U@45m, 0.5U@90m', () => {
      const opts = makeOpts([
        makeTreatment(2, 10),
        makeTreatment(1, 45),
        makeTreatment(0.5, 90),
      ]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });

  describe('basal-like treatments (small insulin < 0.1U)', () => {
    it('small basal adjustment 0.05U at 30m ago — counted as basaliob', () => {
      const opts = makeOpts([makeTreatment(0.05, 30)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('mix of bolus and basal treatments', () => {
      const opts = makeOpts([
        makeTreatment(1.5, 30),    // bolus
        makeTreatment(0.05, 40),   // basal
        makeTreatment(0.05, 50),   // basal
        makeTreatment(0.08, 60),   // basal
      ]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('negative basal adjustment -0.05U', () => {
      const opts = makeOpts([makeTreatment(-0.05, 30)]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });

  describe('different insulin curves', () => {
    it('ultra-rapid: 1U at 60m ago', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { curve: 'ultra-rapid' as const });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('bilinear with DIA=3: 1U at 60m ago', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { curve: 'bilinear', dia: 3 });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('rapid-acting with DIA=7: 1U at 60m ago', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { dia: 7 });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('unsupported curve falls back to rapid-acting', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { curve: 'unknown-curve' });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });

  describe('DIA enforcement', () => {
    it('DIA < 3 is forced to 3', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { curve: 'bilinear', dia: 2 });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('rapid-acting DIA < 5 is forced to 5', () => {
      const opts = makeOpts([makeTreatment(1, 60)], { curve: 'rapid-acting' as const, dia: 3 });
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('no treatments', () => {
      const opts = makeOpts([]);
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });

    it('null treatments returns empty object', () => {
      const opts = { treatments: null, profile: { dia: 5, curve: 'rapid-acting' as const }, calculate: iobCalc };
      expect(iobTotal(opts, NOW)).toMatchSnapshot();
    });

    it('treatment in the future is ignored', () => {
      const opts = makeOpts([makeTreatment(1, -30)]); // 30m in the future
      expect(normalize(iobTotal(opts, NOW))).toMatchSnapshot();
    });
  });
});
