import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tuneCarbRatio } from '../../../src/autotune/tune-carb-ratio';
import type { AutotuneBounds } from '../../../src/autotune/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BOUNDS: AutotuneBounds = { autotuneMax: 1.2, autotuneMin: 0.7 };

// ---------------------------------------------------------------------------
// tuneCarbRatio
// ---------------------------------------------------------------------------

describe('tuneCarbRatio', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('returns currentCarbRatio unchanged when totalCR is 0 (no meals)', () => {
        // fullNewCR = 12 (since totalCR=0), newCR = 0.8*12 + 0.2*12 = 12
        const result = tuneCarbRatio(0, 12, 12, DEFAULT_BOUNDS);
        expect(result).toBe(12);
    });

    it('blends current CR with totalCR at 20% adjustment', () => {
        // pumpCR=10 → maxCR=12, minCR=7
        // fullNewCR = 11 (totalCR, within bounds)
        // newCR = 0.8*10 + 0.2*11 = 10.2
        const result = tuneCarbRatio(11, 10, 10, DEFAULT_BOUNDS);
        expect(result).toBe(10.2);
    });

    it('caps fullNewCR at autotuneMax * pumpCarbRatio', () => {
        // pumpCR=10, autotuneMax=1.2 → maxCR=12
        // fullNewCR=20 > 12 → capped to 12
        // newCR = 0.8*10 + 0.2*12 = 10.4
        const result = tuneCarbRatio(20, 10, 10, DEFAULT_BOUNDS);
        expect(result).toBe(10.4);
        expect(console.log).toHaveBeenCalledWith(
            'Limiting fullNewCR from 20 to 12.00 (which is 1.2 * pump CR of 10)',
        );
    });

    it('caps fullNewCR at autotuneMin * pumpCarbRatio', () => {
        // pumpCR=10, autotuneMin=0.7 → minCR=7
        // fullNewCR=5 < 7 → capped to 7
        // newCR = 0.8*10 + 0.2*7 = 9.4
        const result = tuneCarbRatio(5, 10, 10, DEFAULT_BOUNDS);
        expect(result).toBe(9.4);
        expect(console.log).toHaveBeenCalledWith(
            'Limiting fullNewCR from 5 to 7.00 (which is 0.7 * pump CR of 10)',
        );
    });

    it('caps blended newCR at autotuneMax * pumpCarbRatio', () => {
        // currentCR=14, pumpCR=10 → maxCR=12
        // fullNewCR=totalCR=12 (already capped)
        // newCR = 0.8*14 + 0.2*12 = 13.6 > 12 → capped to 12
        const result = tuneCarbRatio(12, 14, 10, DEFAULT_BOUNDS);
        expect(result).toBe(12);
        expect(console.log).toHaveBeenCalledWith(
            'Limiting CR to 12.00 (which is 1.2 * pump CR of 10)',
        );
    });

    it('caps maxCR at MAX_CARB_RATIO (150)', () => {
        // pumpCR=130, autotuneMax=1.2 → 156 > 150 → maxCR=150
        // minCR = 130*0.7 = 91
        const bounds: AutotuneBounds = { autotuneMax: 1.2, autotuneMin: 0.7 };
        const result = tuneCarbRatio(160, 100, 130, bounds);
        // fullNewCR=160 > 150 → capped to 150
        // newCR = 0.8*100 + 0.2*150 = 110 (> minCR=91)
        expect(result).toBe(110);
    });

    it('caps minCR at MIN_CARB_RATIO (1)', () => {
        // pumpCR=1, autotuneMin=0.7 → minCR=0.7 < 1 → minCR=1
        const bounds: AutotuneBounds = { autotuneMax: 1.2, autotuneMin: 0.7 };
        const result = tuneCarbRatio(0.5, 2, 1, bounds);
        // fullNewCR=0.5 < 1 → capped to 1
        // newCR = 0.8*2 + 0.2*1 = 1.8 (> maxCR=1.2)
        // capped to maxCR = 1*1.2 = 1.2
        expect(result).toBe(1.2);
    });

    it('rounds result to 3 decimal places', () => {
        const result = tuneCarbRatio(0, 10.1115, 10, DEFAULT_BOUNDS);
        expect(result).toBe(10.112);
    });

    it('logs oldCR, fullNewCR, and newCR', () => {
        tuneCarbRatio(0, 12, 12, DEFAULT_BOUNDS);
        expect(console.log).toHaveBeenCalledWith(
            'oldCR: 12 fullNewCR: 12 newCR: 12',
        );
    });
});
