import { describe, it, expect } from 'vitest';
import { iobCalcBilinear } from '../../../src/iob/curveBilinear';
import type { Treatment } from '../../../src/types/index';

function makeTreatment(insulin: number, dateMs: number = 0): Treatment {
    return { insulin, date: dateMs } as Treatment;
}

describe('iobCalcBilinear', () => {

    // --- DIA = 3h (default) ---

    it('returns full IOB immediately after bolus (minsAgo=0, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 0, 3);
        expect(result.iobContrib).toBeCloseTo(1.0, 6);
        expect(result.activityContrib).toBe(0);
    });

    it('returns decreasing IOB mid-way before peak (minsAgo=30, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 30, 3);
        expect(result.iobContrib).toBeGreaterThan(0.9);
        expect(result.iobContrib).toBeLessThan(1.0);
        expect(result.activityContrib).toBeGreaterThan(0);
    });

    it('returns activity and IOB at peak (minsAgo=75, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 75, 3);
        // At peak, transitions from pre-peak to post-peak formula
        expect(result.iobContrib).toBeGreaterThan(0.4);
        expect(result.iobContrib).toBeLessThan(0.6);
        expect(result.activityContrib).toBeGreaterThan(0);
    });

    it('returns small IOB near end (minsAgo=170, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 170, 3);
        expect(result.iobContrib).toBeGreaterThan(0);
        expect(result.iobContrib).toBeLessThan(0.1);
    });

    it('returns zero IOB past end (minsAgo=180, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 180, 3);
        expect(result.iobContrib).toBe(0);
        expect(result.activityContrib).toBe(0);
    });

    it('returns zero IOB well past end (minsAgo=300, DIA=3)', () => {
        const result = iobCalcBilinear(makeTreatment(1), 300, 3);
        expect(result.iobContrib).toBe(0);
        expect(result.activityContrib).toBe(0);
    });

    // --- Scaling with insulin amount ---

    it('scales linearly with insulin amount', () => {
        const r1 = iobCalcBilinear(makeTreatment(1), 50, 3);
        const r2 = iobCalcBilinear(makeTreatment(2), 50, 3);
        expect(r2.iobContrib).toBeCloseTo(r1.iobContrib * 2, 10);
        expect(r2.activityContrib).toBeCloseTo(r1.activityContrib * 2, 10);
    });

    // --- Different DIA values ---

    it('extends tail with longer DIA (DIA=6)', () => {
        // With DIA=6, time is scaled by 3/6 = 0.5, so minsAgo=180 maps to scaled=90
        // which is post-peak (peak=75) but well before end (180)
        const result = iobCalcBilinear(makeTreatment(1), 180, 6);
        expect(result.iobContrib).toBeGreaterThan(0.3);
    });

    it('shortens tail with shorter DIA (DIA=2)', () => {
        // With DIA=2, time is scaled by 3/2 = 1.5, so minsAgo=100 maps to scaled=150
        // past peak, close to end
        const result = iobCalcBilinear(makeTreatment(1), 100, 2);
        expect(result.iobContrib).toBeGreaterThan(0);
        expect(result.iobContrib).toBeLessThan(0.2);
    });

    // --- Exact snapshot values for regression ---

    it('produces exact values at known points (regression)', () => {
        const t = makeTreatment(1);
        const r0 = iobCalcBilinear(t, 0, 3);
        const r50 = iobCalcBilinear(t, 50, 3);
        const r100 = iobCalcBilinear(t, 100, 3);
        const r150 = iobCalcBilinear(t, 150, 3);

        expect(r0.iobContrib).toMatchInlineSnapshot('1');
        expect(r50.iobContrib).toMatchInlineSnapshot(`0.79628`);
        expect(r100.iobContrib).toMatchInlineSnapshot(`0.31747000000000003`);
        expect(r150.iobContrib).toMatchInlineSnapshot(`0.039739999999999887`);
    });
});
