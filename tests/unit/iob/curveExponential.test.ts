import { describe, it, expect } from 'vitest';
import { iobCalcExponential } from '../../../src/iob/curveExponential';
import type { Treatment } from '../../../src/types/index';
import type { IobCalcProfile } from '../../../src/iob/types';

function makeTreatment(insulin: number, dateMs: number = 0): Treatment {
    return { insulin, date: dateMs } as Treatment;
}

const rapidProfile: IobCalcProfile = {
    dia: 6,
    curve: 'rapid-acting',
};

const ultraRapidProfile: IobCalcProfile = {
    dia: 6,
    curve: 'ultra-rapid',
};

describe('iobCalcExponential', () => {

    // --- Rapid-acting with default peak ---

    it('returns full IOB immediately after bolus (rapid-acting)', () => {
        const result = iobCalcExponential(makeTreatment(1), 0, 6, 75, rapidProfile);
        expect(result.iobContrib).toBeCloseTo(1.0, 5);
        expect(result.activityContrib).toBe(0);
    });

    it('returns decreasing IOB at 60 minutes (rapid-acting)', () => {
        const result = iobCalcExponential(makeTreatment(1), 60, 6, 75, rapidProfile);
        expect(result.iobContrib).toBeGreaterThan(0.5);
        expect(result.iobContrib).toBeLessThan(1.0);
        expect(result.activityContrib).toBeGreaterThan(0);
    });

    it('returns near-zero IOB near DIA end (rapid-acting, DIA=6)', () => {
        const result = iobCalcExponential(makeTreatment(1), 350, 6, 75, rapidProfile);
        expect(result.iobContrib).toBeGreaterThan(0);
        expect(result.iobContrib).toBeLessThan(0.05);
    });

    it('returns zero IOB past DIA end (rapid-acting, DIA=6)', () => {
        const result = iobCalcExponential(makeTreatment(1), 360, 6, 75, rapidProfile);
        expect(result.iobContrib).toBe(0);
        expect(result.activityContrib).toBe(0);
    });

    // --- Ultra-rapid with default peak ---

    it('returns full IOB immediately after bolus (ultra-rapid)', () => {
        const result = iobCalcExponential(makeTreatment(1), 0, 6, 55, ultraRapidProfile);
        expect(result.iobContrib).toBeCloseTo(1.0, 5);
        expect(result.activityContrib).toBe(0);
    });

    it('ultra-rapid decays faster than rapid-acting at same time point', () => {
        const rapid = iobCalcExponential(makeTreatment(1), 120, 6, 75, rapidProfile);
        const ultra = iobCalcExponential(makeTreatment(1), 120, 6, 55, ultraRapidProfile);
        expect(ultra.iobContrib).toBeLessThan(rapid.iobContrib);
    });

    // --- Custom peak time ---

    it('uses custom peak time when enabled (rapid-acting)', () => {
        const customProfile: IobCalcProfile = {
            dia: 6,
            curve: 'rapid-acting',
            useCustomPeakTime: true,
            insulinPeakTime: 90,
        };
        const withDefault = iobCalcExponential(makeTreatment(1), 60, 6, 75, rapidProfile);
        const withCustom = iobCalcExponential(makeTreatment(1), 60, 6, 75, customProfile);
        // Different peaks should produce different IOB values at the same time
        expect(withCustom.iobContrib).not.toBeCloseTo(withDefault.iobContrib, 3);
    });

    // --- Peak clamping ---

    it('clamps rapid-acting peak to max (120)', () => {
        const clampedProfile: IobCalcProfile = {
            dia: 6,
            curve: 'rapid-acting',
            useCustomPeakTime: true,
            insulinPeakTime: 200, // above max of 120
        };
        const atMax: IobCalcProfile = {
            dia: 6,
            curve: 'rapid-acting',
            useCustomPeakTime: true,
            insulinPeakTime: 120,
        };
        const clamped = iobCalcExponential(makeTreatment(1), 60, 6, 75, clampedProfile);
        const exact = iobCalcExponential(makeTreatment(1), 60, 6, 75, atMax);
        expect(clamped.iobContrib).toBeCloseTo(exact.iobContrib, 10);
    });

    it('clamps rapid-acting peak to min (50)', () => {
        const clampedProfile: IobCalcProfile = {
            dia: 6,
            curve: 'rapid-acting',
            useCustomPeakTime: true,
            insulinPeakTime: 10, // below min of 50
        };
        const atMin: IobCalcProfile = {
            dia: 6,
            curve: 'rapid-acting',
            useCustomPeakTime: true,
            insulinPeakTime: 50,
        };
        const clamped = iobCalcExponential(makeTreatment(1), 60, 6, 75, clampedProfile);
        const exact = iobCalcExponential(makeTreatment(1), 60, 6, 75, atMin);
        expect(clamped.iobContrib).toBeCloseTo(exact.iobContrib, 10);
    });

    it('clamps ultra-rapid peak to max (100)', () => {
        const clampedProfile: IobCalcProfile = {
            dia: 6,
            curve: 'ultra-rapid',
            useCustomPeakTime: true,
            insulinPeakTime: 150, // above max of 100
        };
        const atMax: IobCalcProfile = {
            dia: 6,
            curve: 'ultra-rapid',
            useCustomPeakTime: true,
            insulinPeakTime: 100,
        };
        const clamped = iobCalcExponential(makeTreatment(1), 60, 6, 55, clampedProfile);
        const exact = iobCalcExponential(makeTreatment(1), 60, 6, 55, atMax);
        expect(clamped.iobContrib).toBeCloseTo(exact.iobContrib, 10);
    });

    it('clamps ultra-rapid peak to min (35)', () => {
        const clampedProfile: IobCalcProfile = {
            dia: 6,
            curve: 'ultra-rapid',
            useCustomPeakTime: true,
            insulinPeakTime: 10, // below min of 35
        };
        const atMin: IobCalcProfile = {
            dia: 6,
            curve: 'ultra-rapid',
            useCustomPeakTime: true,
            insulinPeakTime: 35,
        };
        const clamped = iobCalcExponential(makeTreatment(1), 60, 6, 55, clampedProfile);
        const exact = iobCalcExponential(makeTreatment(1), 60, 6, 55, atMin);
        expect(clamped.iobContrib).toBeCloseTo(exact.iobContrib, 10);
    });

    // --- Scaling ---

    it('scales linearly with insulin amount', () => {
        const r1 = iobCalcExponential(makeTreatment(1), 60, 6, 75, rapidProfile);
        const r2 = iobCalcExponential(makeTreatment(3), 60, 6, 75, rapidProfile);
        expect(r2.iobContrib).toBeCloseTo(r1.iobContrib * 3, 10);
        expect(r2.activityContrib).toBeCloseTo(r1.activityContrib * 3, 10);
    });

    // --- Exact regression values ---

    it('produces exact values at known points (regression, rapid-acting)', () => {
        const t = makeTreatment(1);
        const r0 = iobCalcExponential(t, 0, 6, 75, rapidProfile);
        const r60 = iobCalcExponential(t, 60, 6, 75, rapidProfile);
        const r180 = iobCalcExponential(t, 180, 6, 75, rapidProfile);
        const r300 = iobCalcExponential(t, 300, 6, 75, rapidProfile);

        expect(r0.iobContrib).toMatchInlineSnapshot('1');
        expect(r60.iobContrib).toMatchInlineSnapshot(`0.7792959813945408`);
        expect(r180.iobContrib).toMatchInlineSnapshot(`0.20817073431377964`);
        expect(r300.iobContrib).toMatchInlineSnapshot(`0.013918062554445276`);
    });

    it('produces exact values at known points (regression, ultra-rapid)', () => {
        const t = makeTreatment(1);
        const r0 = iobCalcExponential(t, 0, 6, 55, ultraRapidProfile);
        const r60 = iobCalcExponential(t, 60, 6, 55, ultraRapidProfile);
        const r180 = iobCalcExponential(t, 180, 6, 55, ultraRapidProfile);
        const r300 = iobCalcExponential(t, 300, 6, 55, ultraRapidProfile);

        expect(r0.iobContrib).toMatchInlineSnapshot('1');
        expect(r60.iobContrib).toMatchInlineSnapshot(`0.6807104906555019`);
        expect(r180.iobContrib).toMatchInlineSnapshot(`0.11466084114529174`);
        expect(r300.iobContrib).toMatchInlineSnapshot(`0.004820784978285864`);
    });
});
