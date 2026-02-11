/**
 * Characterization tests for iob/calculate.js
 *
 * Tests the per-treatment insulin absorption curve calculations
 * across all three curve types: bilinear, rapid-acting, ultra-rapid.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const iobCalc = require('../../../lib/iob/calculate');

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
