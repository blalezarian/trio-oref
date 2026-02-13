import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    padDeviations,
    analyzePercentiles,
    calculateAutosensRatio,
} from '../../../src/autosens/calculate-ratio';

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// padDeviations
// ---------------------------------------------------------------------------

describe('padDeviations', () => {
    it('adds zero deviations when data is sparse', () => {
        const devs = [1, 2, 3];
        padDeviations(devs, 96, 18);
        // (1 - 3/96) * 18 ≈ 17.4 → round → 17
        expect(devs.length).toBe(3 + 17);
        expect(devs.slice(3).every(d => d === 0)).toBe(true);
    });

    it('does not pad when deviations meet target length', () => {
        const devs = Array(96).fill(1);
        padDeviations(devs, 96, 18);
        expect(devs.length).toBe(96);
    });

    it('pads proportional to sparseness', () => {
        const devs = Array(48).fill(1); // 50% of target
        padDeviations(devs, 96, 18);
        // (1 - 48/96) * 18 = 9
        expect(devs.length).toBe(48 + 9);
    });
});

// ---------------------------------------------------------------------------
// analyzePercentiles
// ---------------------------------------------------------------------------

describe('analyzePercentiles', () => {
    it('returns pSensitive and pResistant from 50th percentile', () => {
        // Sorted: [-3, -2, -1, 0, 1, 2, 3]
        const devs = [3, -1, 2, 0, -3, 1, -2];
        const result = analyzePercentiles(devs, [1, 2, 3], [1, 2, 3]);
        expect(result).toHaveProperty('pSensitive');
        expect(result).toHaveProperty('pResistant');
        expect(typeof result.pSensitive).toBe('number');
    });

    it('sorts all three arrays in-place', () => {
        const devs = [3, 1, 2];
        const avgDeltas = [3, 1, 2];
        const bgis = [3, 1, 2];
        analyzePercentiles(devs, avgDeltas, bgis);
        expect(devs).toEqual([1, 2, 3]);
        expect(avgDeltas).toEqual([1, 2, 3]);
        expect(bgis).toEqual([1, 2, 3]);
    });

    it('all negative deviations: pSensitive is negative', () => {
        const devs = [-5, -4, -3, -2, -1];
        const result = analyzePercentiles(devs, [-1], [-1]);
        expect(result.pSensitive).toBeLessThan(0);
    });

    it('all positive deviations: pResistant is positive', () => {
        const devs = [1, 2, 3, 4, 5];
        const result = analyzePercentiles(devs, [1], [1]);
        expect(result.pResistant).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// calculateAutosensRatio
// ---------------------------------------------------------------------------

describe('calculateAutosensRatio', () => {
    const baseProfile = {
        sens: 40,
        max_daily_basal: 1,
        autosens_min: 0.7,
        autosens_max: 1.2,
    };

    it('returns ratio 1.0 when pSensitive=0 and pResistant=0', () => {
        const result = calculateAutosensRatio([0, 0, 0], 0, 0, baseProfile);
        expect(result.ratio).toBe(1);
        expect(result.newisf).toBe(40);
    });

    it('detects sensitivity (pSensitive < 0)', () => {
        const result = calculateAutosensRatio([-1, -2, -3], -2, 0, baseProfile);
        expect(result.ratio).toBeLessThan(1);
    });

    it('detects resistance (pResistant > 0)', () => {
        const result = calculateAutosensRatio([1, 2, 3], 0, 2, baseProfile);
        expect(result.ratio).toBeGreaterThan(1);
    });

    it('clamps ratio to autosens_max', () => {
        // Very high pResistant
        const result = calculateAutosensRatio([10, 20, 30], 0, 20, baseProfile);
        expect(result.ratio).toBeLessThanOrEqual(1.2);
    });

    it('clamps ratio to autosens_min', () => {
        // Very low pSensitive
        const result = calculateAutosensRatio([-10, -20, -30], -20, 0, baseProfile);
        expect(result.ratio).toBeGreaterThanOrEqual(0.7);
    });

    it('adjusts newisf based on ratio', () => {
        const result = calculateAutosensRatio([0, 0, 0], 0, 0, baseProfile);
        expect(result.newisf).toBe(Math.round(baseProfile.sens / result.ratio));
    });

    it('rounds ratio to 2 decimal places', () => {
        const result = calculateAutosensRatio([-1], -1, 0, baseProfile);
        const decimalPlaces = result.ratio.toString().split('.')[1]?.length ?? 0;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
});
