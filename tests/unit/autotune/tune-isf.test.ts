import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    collectISFStatistics,
    tuneISF,
} from '../../../src/autotune/tune-isf';
import type {
    AutotuneGlucoseDatum,
    AutotuneBounds,
} from '../../../src/autotune/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDatum(overrides: Partial<AutotuneGlucoseDatum> = {}): AutotuneGlucoseDatum {
    return {
        deviation: 5,
        BGI: -2,
        avgDelta: -3,
        ...overrides,
    };
}

const DEFAULT_BOUNDS: AutotuneBounds = { autotuneMax: 1.2, autotuneMin: 0.7 };

// ---------------------------------------------------------------------------
// collectISFStatistics
// ---------------------------------------------------------------------------

describe('collectISFStatistics', () => {
    it('returns empty arrays for no glucose data', () => {
        const result = collectISFStatistics([]);
        expect(result.deviations).toEqual([]);
        expect(result.BGIs).toEqual([]);
        expect(result.avgDeltas).toEqual([]);
        expect(result.ratios).toEqual([]);
    });

    it('collects and sorts deviations, BGIs, avgDeltas, ratios', () => {
        const data = [
            makeDatum({ deviation: 10, BGI: -5, avgDelta: -1 }),
            makeDatum({ deviation: 2, BGI: -10, avgDelta: -4 }),
            makeDatum({ deviation: 6, BGI: -2, avgDelta: -2 }),
        ];
        const result = collectISFStatistics(data);
        // All arrays should be sorted ascending
        expect(result.deviations).toEqual([2, 6, 10]);
        expect(result.BGIs).toEqual([-10, -5, -2]);
        expect(result.avgDeltas).toEqual([-4, -2, -1]);
        // ratios: 1 + dev/BGI → 1+10/-5=-1, 1+2/-10=0.8, 1+6/-2=-2
        expect(result.ratios).toEqual([-2, -1, 0.8]);
    });

    it('computes ratio as 1 + deviation / BGI', () => {
        const data = [makeDatum({ deviation: 4, BGI: -2 })];
        const result = collectISFStatistics(data);
        // ratio = 1 + 4 / -2 = -1
        expect(result.ratios).toEqual([-1]);
    });
});

// ---------------------------------------------------------------------------
// tuneISF
// ---------------------------------------------------------------------------

describe('tuneISF', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('leaves ISF unchanged when fewer than 10 data points', () => {
        const data = Array.from({ length: 5 }, () =>
            makeDatum({ deviation: 5, BGI: -2, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        expect(result.fullNewISF).toBe(40);
        expect(console.log).toHaveBeenCalledWith(
            'Only found 5 ISF data points, leaving ISF unchanged at 40',
        );
    });

    it('tunes ISF based on median ratio with 10+ data points', () => {
        // All ratios = 1 + 5/-2 = -1.5 → p50ratios = -1.5
        // fullNewISF = 40 * -1.5 = -60 → but rounds: -60
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 5, BGI: -2, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        // fullNewISF < 0 so adjustedISF = currentISF = 40
        expect(result.fullNewISF).toBe(-60);
    });

    it('uses default ISF adjustment fraction of 1.0 when not specified', () => {
        // With adjustmentFraction=1.0: adjustedISF = 1.0*fullNewISF + 0*pumpISF = fullNewISF
        // All ratios = 1 + 2/-4 = 0.5 → p50ratios = 0.5
        // fullNewISF = 40 * 0.5 = 20
        // adjustedISF = 1.0 * 20 = 20
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 2, BGI: -4, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        // minISF = 40/1.2 = 33.333, maxISF = 40/0.7 = 57.143
        // adjustedISF = 20 < minISF → capped to 33.333
        // newISF = 0.8*40 + 0.2*33.333 = 38.667
        expect(result.adjustedISF).toBeCloseTo(33.333, 1);
    });

    it('uses custom ISF adjustment fraction when specified', () => {
        // ratio = 1 + 2/-4 = 0.5, fullNewISF = 40 * 0.5 = 20
        // adjustmentFraction = 0.5: adjustedISF = 0.5*20 + 0.5*40 = 30
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 2, BGI: -4, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, 0.5);
        // adjustedISF = 30 < minISF(33.333) → capped
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('Limiting adjusted ISF of'),
        );
    });

    it('caps ISF at maxISF (pumpISF / autotuneMin)', () => {
        // ratio close to 2 → fullNewISF ~ 80 → adjustedISF ~ 80
        // maxISF = 40/0.7 = 57.143 → capped
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: -3, BGI: -3, avgDelta: -1 }),
        );
        // ratio = 1 + (-3)/(-3) = 2, fullNewISF = 40*2 = 80
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        // adjustedISF = 80 > 57.143 → capped
        const maxISF = 40 / 0.7;
        expect(result.adjustedISF).toBeCloseTo(maxISF, 0);
    });

    it('caps ISF at minISF (pumpISF / autotuneMax)', () => {
        // ratio close to 0 → fullNewISF ~ 0 → adjustedISF ~ 0
        // minISF = 40/1.2 = 33.333 → capped
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 4, BGI: -4, avgDelta: -1 }),
        );
        // ratio = 1 + 4/(-4) = 0, fullNewISF = 40*0 = 0
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        const minISF = 40 / 1.2;
        expect(result.adjustedISF).toBeCloseTo(minISF, 0);
    });

    it('returns oldISF matching the currentISF input', () => {
        const result = tuneISF([], 42, 40, DEFAULT_BOUNDS, undefined);
        expect(result.oldISF).toBe(42);
    });

    it('rounds newISF and adjustedISF to 3 decimal places', () => {
        const result = tuneISF([], 40, 40, DEFAULT_BOUNDS, undefined);
        // With no data, newISF and adjustedISF are rounded
        const decimal = (result.newISF * 1000) % 1;
        expect(decimal).toBe(0);
    });

    it('returns NaN for newISF and adjustedISF when pumpISF is undefined', () => {
        // Line 64: pumpISF === undefined → early return with NaN values
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 2, BGI: -4, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, undefined, DEFAULT_BOUNDS, undefined);
        expect(Number.isNaN(result.newISF)).toBe(true);
        expect(Number.isNaN(result.adjustedISF)).toBe(true);
        expect(result.oldISF).toBe(40);
        expect(result.p50deviation).toBeDefined();
        expect(result.p50BGI).toBeDefined();
        expect(result.p50ratios).toBeDefined();
        expect(result.fullNewISF).toBeDefined();
    });

    it('handles fullNewISF < 0 by using currentISF as adjustedISF', () => {
        // Line 81: if (fullNewISF < 0) { adjustedISF = currentISF; }
        // ratio = 1 + 5/(-2) = -1.5 → fullNewISF = 40 * -1.5 = -60
        const data = Array.from({ length: 12 }, () =>
            makeDatum({ deviation: 5, BGI: -2, avgDelta: -1 }),
        );
        const result = tuneISF(data, 40, 40, DEFAULT_BOUNDS, undefined);
        // fullNewISF = -60 < 0 → adjustedISF = currentISF = 40
        expect(result.fullNewISF).toBe(-60);
        // adjustedISF should be currentISF (40), not negative
        expect(result.adjustedISF).toBe(40);
    });
});
