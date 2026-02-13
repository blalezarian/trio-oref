import { describe, it, expect, vi } from 'vitest';
import { carbRatioLookup } from '../../../src/profile/carbs';
import type { CarbsInputs } from '../../../src/profile/carbs';

describe('carbRatioLookup', () => {
    it('returns undefined when carbratio is missing', () => {
        expect(carbRatioLookup({})).toBeUndefined();
    });

    it('returns undefined when schedule is missing', () => {
        const inputs: CarbsInputs = {
            carbratio: { units: 'grams' },
        };
        expect(carbRatioLookup(inputs)).toBeUndefined();
    });

    it('logs error and returns undefined for unsupported units', () => {
        const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'invalid' as 'grams',
                schedule: [{ offset: 0, ratio: 10 }],
            },
        };
        expect(carbRatioLookup(inputs)).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported carb_ratio units'));
        errorSpy.mockRestore();
    });

    it('returns the correct ratio for grams units', () => {
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 10 }],
            },
        };
        expect(carbRatioLookup(inputs)).toBe(10);
    });

    it('converts exchanges to grams (12 / ratio)', () => {
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'exchanges',
                schedule: [{ offset: 0, ratio: 2 }],
            },
        };
        // 12 / 2 = 6
        expect(carbRatioLookup(inputs)).toBe(6);
    });

    it('returns undefined for ratio below MIN_CARB_RATIO', () => {
        const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 0.5 }],
            },
        };
        expect(carbRatioLookup(inputs)).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('out of bounds'));
        errorSpy.mockRestore();
    });

    it('returns undefined for ratio above MAX_CARB_RATIO', () => {
        const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 200 }],
            },
        };
        expect(carbRatioLookup(inputs)).toBeUndefined();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('out of bounds'));
        errorSpy.mockRestore();
    });

    it('uses last entry as fallback for single-entry schedule', () => {
        const inputs: CarbsInputs = {
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 15 }],
            },
        };
        expect(carbRatioLookup(inputs)).toBe(15);
    });
});
