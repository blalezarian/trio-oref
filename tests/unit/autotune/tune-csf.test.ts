import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    accumulateMealDeviations,
    tuneCSF,
} from '../../../src/autotune/tune-csf';
import type {
    AutotuneGlucoseDatum,
    AutotuneBounds,
} from '../../../src/autotune/types';
import type { MealAbsorptionPhase } from '../../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDatum(overrides: Partial<AutotuneGlucoseDatum> = {}): AutotuneGlucoseDatum {
    return {
        deviation: '5',
        BGI: -1.5,
        avgDelta: '-2',
        ...overrides,
    };
}

const DEFAULT_BOUNDS: AutotuneBounds = { autotuneMax: 1.2, autotuneMin: 0.7 };

// ---------------------------------------------------------------------------
// accumulateMealDeviations
// ---------------------------------------------------------------------------

describe('accumulateMealDeviations', () => {
    it('returns zeros for empty glucose data', () => {
        const result = accumulateMealDeviations([], undefined);
        expect(result.totalMealCarbs).toBe(0);
        expect(result.totalDeviations).toBe(0);
    });

    it('accumulates a single complete meal (start → data → end)', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 45, deviation: '0' }),
            makeDatum({ mealAbsorption: undefined, mealCarbs: 45, deviation: '10' }),
            makeDatum({ mealAbsorption: undefined, mealCarbs: 45, deviation: '8' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 45, deviation: '3' }),
        ];
        const result = accumulateMealDeviations(data, 8);
        // start: deviations=0, mealCarbs=45
        // data: deviations += max(0, 10) = 10; max(0, 8) = 8 → deviations = 18
        // end: deviations += 3 = 21; totalMealCarbs += 45; totalDeviations += 21
        expect(result.totalMealCarbs).toBe(45);
        expect(result.totalDeviations).toBe(21);
    });

    it('handles incomplete meal at midnight (no end marker)', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 30, deviation: '0' }),
            makeDatum({ mealAbsorption: undefined, mealCarbs: 30, deviation: '5' }),
        ];
        const result = accumulateMealDeviations(data, 8);
        // No end marker, totalMealCarbs stays 0, so midnight fallback adds currentMealCarbs
        expect(result.totalMealCarbs).toBe(30);
        expect(result.totalDeviations).toBe(5);
    });

    it('clamps negative deviations to zero in non-start/end entries', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 20, deviation: '0' }),
            makeDatum({ mealAbsorption: undefined, mealCarbs: 20, deviation: '-5' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 20, deviation: '2' }),
        ];
        const result = accumulateMealDeviations(data, 8);
        // data: max(0, -5) = 0, so deviations stays 0
        // end: deviations += 2 = 2
        expect(result.totalDeviations).toBe(2);
    });

    it('accumulates multiple meals', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 20, deviation: '0' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 20, deviation: '10' }),
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 40, deviation: '0' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 40, deviation: '15' }),
        ];
        const result = accumulateMealDeviations(data, 8);
        expect(result.totalMealCarbs).toBe(60);
        expect(result.totalDeviations).toBe(25);
    });
});

// ---------------------------------------------------------------------------
// tuneCSF
// ---------------------------------------------------------------------------

describe('tuneCSF', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('returns currentCSF unchanged when no glucose data', () => {
        const result = tuneCSF([], 10, undefined, undefined, DEFAULT_BOUNDS);
        // fullNewCSF = 10 (no meals), newCSF = 0.8*10 + 0.2*10 = 10
        expect(result).toBe(10);
    });

    it('adjusts CSF based on meal deviations', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 50, deviation: '0' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 50, deviation: '100' }),
        ];
        // totalMealCarbs=50, totalDeviations=100
        // fullNewCSF = round(100/50 * 100)/100 = 2.0
        // newCSF = 0.8*10 + 0.2*2.0 = 8.4
        const result = tuneCSF(data, 10, 8, undefined, DEFAULT_BOUNDS);
        expect(result).toBe(8.4);
    });

    it('caps CSF at autotuneMax * pumpCSF', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 10, deviation: '0' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 10, deviation: '500' }),
        ];
        // Would produce very high CSF, but capped at pumpCSF * autotuneMax = 5 * 1.2 = 6
        const result = tuneCSF(data, 5, 8, 5, DEFAULT_BOUNDS);
        expect(result).toBeLessThanOrEqual(6);
        expect(console.log).toHaveBeenCalledWith(
            'Limiting CSF to 6.00 (which is 1.2 * pump CSF of 5)',
        );
    });

    it('caps CSF at autotuneMin * pumpCSF', () => {
        const data: AutotuneGlucoseDatum[] = [
            makeDatum({ mealAbsorption: 'start' as MealAbsorptionPhase, mealCarbs: 100, deviation: '0' }),
            makeDatum({ mealAbsorption: 'end' as MealAbsorptionPhase, mealCarbs: 100, deviation: '1' }),
        ];
        // fullNewCSF = round(1/100 * 100)/100 = 0.01 → very low
        // newCSF = 0.8*10 + 0.2*0.01 = 8.002 → below pumpCSF * autotuneMin = 10 * 0.7 = 7
        // Actually 8.002 > 7 so not capped. Let me use pumpCSF = 15.
        const result = tuneCSF(data, 10, 8, 15, DEFAULT_BOUNDS);
        // pumpCSF * autotuneMin = 15 * 0.7 = 10.5
        // newCSF = 0.8*10 + 0.2*0.01 = 8.002 < 10.5 → capped at 10.5
        expect(result).toBe(10.5);
    });

    it('rounds result to 3 decimal places', () => {
        const result = tuneCSF([], 10.1115, undefined, undefined, DEFAULT_BOUNDS);
        expect(result).toBe(10.112);
    });

    it('logs totalMealCarbs, totalDeviations, oldCSF, fullNewCSF, newCSF', () => {
        tuneCSF([], 10, undefined, undefined, DEFAULT_BOUNDS);
        expect(console.log).toHaveBeenCalledWith(
            'totalMealCarbs: 0 totalDeviations: 0 oldCSF 10 fullNewCSF: 10 newCSF: 10',
        );
    });
});
