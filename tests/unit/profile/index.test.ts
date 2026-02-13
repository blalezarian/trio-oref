import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generate } from '../../../src/profile/index';
import { resetISFCache } from '../../../src/profile/isf';
import type { ProfileInputs } from '../../../src/profile/types';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

/** Build minimal valid ProfileInputs */
function makeInputs(overrides: Record<string, unknown> = {}): ProfileInputs {
    return {
        settings: {
            insulin_action_curve: 6,
            maxBasal: 3.0,
        },
        basals: [
            { i: 0, minutes: 0, rate: 1.0 },
        ],
        targets: {
            user_preferred_units: 'mg/dL',
            targets: [
                { offset: 0, low: 100, high: 120, min_bg: 100, max_bg: 120 },
            ],
        },
        isf: {
            sensitivities: [
                { offset: 0, sensitivity: 50 },
            ],
        },
        carbratio: {
            units: 'grams',
            schedule: [
                { offset: 0, ratio: 10 },
            ],
        },
        temptargets: [],
        ...overrides,
    } as ProfileInputs;
}

// ---------------------------------------------------------------------------
// generate() — ISF too low branch (lines 91-92)
// ---------------------------------------------------------------------------

describe('generate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FIXED_TIME));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        resetISFCache();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns -1 when ISF is below minimum supported (5 mg/dL/U)', () => {
        const inputs = makeInputs({
            isf: {
                sensitivities: [
                    { offset: 0, sensitivity: 3 },
                ],
            },
        });
        const result = generate(inputs);
        expect(result).toBe(-1);
        expect(console.log).toHaveBeenCalledWith(
            'ISF of 3 is not supported',
        );
    });

    it('returns -1 when ISF equals exactly the minimum (5) — boundary', () => {
        const inputs = makeInputs({
            isf: {
                sensitivities: [
                    { offset: 0, sensitivity: 5 },
                ],
            },
        });
        // ISF of 5 is NOT < 5, so it should succeed
        const result = generate(inputs);
        expect(result).not.toBe(-1);
    });

    it('returns a valid profile for normal inputs', () => {
        const inputs = makeInputs();
        const result = generate(inputs);
        expect(result).not.toBe(-1);
        if (result !== -1) {
            expect(result.sens).toBe(50);
            expect(result.dia).toBe(6);
        }
    });
});
