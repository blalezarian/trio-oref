/**
 * Characterization tests for iob/calculate.js
 *
 * Tests the per-treatment insulin absorption curve calculations
 * across all three curve types: bilinear, rapid-acting, ultra-rapid.
 */

import { describe, it, expect } from 'vitest';
import iobCalc from '../../../lib/iob/calculate';

const baseProfile = {
  dia: 5,
  curve: 'rapid-acting',
  useCustomPeakTime: false,
  insulinPeakTime: 75,
};

function makeTreatment(insulin: number, minsAgo: number, now: Date) {
  return {
    insulin,
    date: now.getTime() - minsAgo * 60_000,
  };
}

const NOW = new Date('2025-01-15T12:00:00.000Z');

describe('iob/calculate characterization tests', () => {
  describe('rapid-acting curve', () => {
    const profile = { ...baseProfile, curve: 'rapid-acting' };
    const timePoints = [0, 5, 15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

    for (const minsAgo of timePoints) {
      it(`1U bolus at ${minsAgo}m ago`, () => {
        const treatment = makeTreatment(1, minsAgo, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
        expect(result).toMatchSnapshot();
      });
    }

    it('2U bolus at 60m ago', () => {
      const treatment = makeTreatment(2, 60, NOW);
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
      expect(result).toMatchSnapshot();
    });

    it('0.5U bolus at 30m ago', () => {
      const treatment = makeTreatment(0.5, 30, NOW);
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
      expect(result).toMatchSnapshot();
    });
  });

  describe('ultra-rapid curve', () => {
    const profile = { ...baseProfile, curve: 'ultra-rapid', insulinPeakTime: 55 };
    const timePoints = [0, 15, 30, 55, 75, 120, 180, 300];

    for (const minsAgo of timePoints) {
      it(`1U bolus at ${minsAgo}m ago`, () => {
        const treatment = makeTreatment(1, minsAgo, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 55, profile);
        expect(result).toMatchSnapshot();
      });
    }
  });

  describe('bilinear curve', () => {
    const profile = { ...baseProfile, curve: 'bilinear', dia: 3 };
    const timePoints = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180];

    for (const minsAgo of timePoints) {
      it(`1U bolus at ${minsAgo}m ago (DIA=3h)`, () => {
        const treatment = makeTreatment(1, minsAgo, NOW);
        const result = iobCalc(treatment, NOW, 'bilinear', 3, 75, profile);
        expect(result).toMatchSnapshot();
      });
    }

    it('1U bolus at 60m ago with DIA=5h', () => {
      const treatment = makeTreatment(1, 60, NOW);
      const result = iobCalc(treatment, NOW, 'bilinear', 5, 75, profile);
      expect(result).toMatchSnapshot();
    });
  });

  describe('custom peak time', () => {
    it('rapid-acting with custom peak 50m', () => {
      const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 50 };
      const treatment = makeTreatment(1, 60, NOW);
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 50, profile);
      expect(result).toMatchSnapshot();
    });

    it('rapid-acting with custom peak 120m', () => {
      const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 120 };
      const treatment = makeTreatment(1, 60, NOW);
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 120, profile);
      expect(result).toMatchSnapshot();
    });

    it('ultra-rapid with custom peak 35m', () => {
      const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 35 };
      const treatment = makeTreatment(1, 60, NOW);
      const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 35, profile);
      expect(result).toMatchSnapshot();
    });
  });

  describe('custom peak time - coverage gap fills', () => {
    describe('rapid-acting out-of-range peak clamping', () => {
      it('peak > 120 is clamped to 120', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 150 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 150, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak < 50 is clamped to 50', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 30 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 30, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak exactly at 50 (minimum boundary)', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 50 };
        const treatment = makeTreatment(1, 30, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 50, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak exactly at 120 (maximum boundary)', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 120 };
        const treatment = makeTreatment(1, 30, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 120, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak at 75 (middle of valid range)', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 75 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('ultra-rapid out-of-range peak clamping', () => {
      it('peak > 100 is clamped to 100', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 130 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 130, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak < 35 is clamped to 35', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 20 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 20, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak exactly at 35 (minimum boundary)', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 35 };
        const treatment = makeTreatment(1, 30, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 35, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak exactly at 100 (maximum boundary)', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 100 };
        const treatment = makeTreatment(1, 30, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 100, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak at 55 (default ultra-rapid peak)', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 55 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 55, profile);
        expect(result).toMatchSnapshot();
      });

      it('peak at 45 (Fiasp-like)', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 45 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 45, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('rapid-acting with useCustomPeakTime: true at various time points', () => {
      const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 45 };
      const timePoints = [0, 15, 30, 45, 60, 90, 120, 180, 240, 300];

      for (const minsAgo of timePoints) {
        it(`Fiasp-like peak 45m: 1U at ${minsAgo}m ago`, () => {
          const treatment = makeTreatment(1, minsAgo, NOW);
          // insulinPeakTime 45 < 50 minimum for rapid-acting, so it gets clamped to 50
          const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 45, profile);
          expect(result).toMatchSnapshot();
        });
      }
    });

    describe('ultra-rapid with useCustomPeakTime: true at various time points', () => {
      const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 45 };
      const timePoints = [0, 15, 30, 45, 60, 90, 120, 180, 240, 300];

      for (const minsAgo of timePoints) {
        it(`custom peak 45m: 1U at ${minsAgo}m ago`, () => {
          const treatment = makeTreatment(1, minsAgo, NOW);
          const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 45, profile);
          expect(result).toMatchSnapshot();
        });
      }
    });

    describe('useCustomPeakTime with insulinPeakTime undefined', () => {
      it('rapid-acting falls back to default peak 75', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: undefined };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
        expect(result).toMatchSnapshot();
      });

      it('ultra-rapid falls back to default peak 55', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: undefined };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 55, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('useCustomPeakTime: false falls back to defaults', () => {
      it('rapid-acting default peak 75', () => {
        const profile = { ...baseProfile, useCustomPeakTime: false, insulinPeakTime: 45 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, profile);
        expect(result).toMatchSnapshot();
      });

      it('ultra-rapid default peak 55', () => {
        const profile = { ...baseProfile, curve: 'ultra-rapid', useCustomPeakTime: false, insulinPeakTime: 45 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'ultra-rapid', 5, 55, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('unsupported curve type', () => {
      it('unknown curve logs error and uses exponential without peak override', () => {
        const profile = { ...baseProfile, curve: 'some-unknown-curve' };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'some-unknown-curve', 5, 75, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('bilinear with custom peak time (peak is ignored for bilinear)', () => {
      it('bilinear ignores useCustomPeakTime', () => {
        const profile = { ...baseProfile, curve: 'bilinear', useCustomPeakTime: true, insulinPeakTime: 45 };
        const treatment = makeTreatment(1, 60, NOW);
        const result = iobCalc(treatment, NOW, 'bilinear', 5, 45, profile);
        expect(result).toMatchSnapshot();
      });
    });

    describe('exponential curve with time undefined', () => {
      it('rapid-acting with undefined time uses current time', () => {
        const profile = { ...baseProfile, useCustomPeakTime: true, insulinPeakTime: 75 };
        const treatment = { insulin: 1, date: Date.now() - 60 * 60_000 };
        const result = iobCalc(treatment, undefined, 'rapid-acting', 5, 75, profile);
        expect(result).toBeDefined();
        expect(result.iobContrib).toBeTypeOf('number');
        expect(result.activityContrib).toBeTypeOf('number');
      });
    });
  });

  describe('edge cases', () => {
    it('zero insulin treatment', () => {
      const treatment = { insulin: 0, date: NOW.getTime() - 60 * 60_000 };
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, baseProfile);
      expect(result).toMatchSnapshot();
    });

    it('no insulin property', () => {
      const treatment = { date: NOW.getTime() - 60 * 60_000 };
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, baseProfile);
      expect(result).toMatchSnapshot();
    });

    it('treatment in the future', () => {
      const treatment = makeTreatment(1, -10, NOW); // 10m in the future
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, baseProfile);
      expect(result).toMatchSnapshot();
    });

    it('very old treatment (past DIA)', () => {
      const treatment = makeTreatment(1, 360, NOW); // 6h ago, past 5h DIA
      const result = iobCalc(treatment, NOW, 'rapid-acting', 5, 75, baseProfile);
      expect(result).toMatchSnapshot();
    });
  });
});
