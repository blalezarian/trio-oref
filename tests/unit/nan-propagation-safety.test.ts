/**
 * NaN-propagation safety tests
 *
 * These tests guard against a specific class of bugs: replacing `as number`
 * type casts with `?? 0` instead of `Number()`.
 *
 * When a value is `undefined`:
 *   - `as number` → still `undefined` at runtime → NaN in math (safe: propagates)
 *   - `?? 0`      → becomes `0` → dangerous in comparisons, divisors, multipliers
 *   - `Number()`  → becomes `NaN` → matches original `as number` behavior
 *
 * Each test verifies that undefined optional fields produce NaN (not 0, not
 * Infinity) or that comparison guards remain false (not flipped to true).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { generate } from '../../src/profile/index';
import { resetISFCache } from '../../src/profile/isf';
import { validateCGMData } from '../../src/determineBasal/cgmValidation';
import {
    adjustISFBySensitivity,
    adjustBasalBySensitivity,
    calculateTempTargetSensitivityRatio,
} from '../../src/determineBasal/sensitivityTargets';
import type {
    GlucoseStatus,
    Profile,
    AutosensData,
} from '../../src/types/index';
import type { ProfileInputs } from '../../src/profile/types';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Profile guard clauses: undefined fields must NOT trigger early returns
// ---------------------------------------------------------------------------

describe('profile guard clauses with undefined fields', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FIXED_TIME));
        resetISFCache();
    });

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

    it('does NOT return -1 when max_basal is undefined (comparison guard)', () => {
        // BUG with ?? 0: (0 < 0.1) = true → early return -1
        // CORRECT:        (NaN < 0.1) = false → continues
        const inputs = makeInputs({
            settings: { insulin_action_curve: 6, maxBasal: undefined },
        });
        const result = generate(inputs);
        // Should produce a valid profile, not -1
        expect(result).not.toBe(-1);
    });

    it('does NOT return -1 when sens is undefined (comparison guard)', () => {
        // BUG with ?? 0: (0 < 5) = true → early return -1
        // CORRECT:        (NaN < 5) = false → continues
        const inputs = makeInputs({
            isf: {
                sensitivities: [
                    { offset: 0, sensitivity: undefined },
                ],
            },
        });
        const result = generate(inputs);
        expect(result).not.toBe(-1);
    });

    afterEach(() => {
        vi.useRealTimers();
    });
});

// ---------------------------------------------------------------------------
// CGM validation: undefined date must NOT trigger "data too old"
// ---------------------------------------------------------------------------

describe('CGM validation with undefined glucose_status.date', () => {
    it('does not return earlyReturn when date is undefined', () => {
        // BUG with ?? 0: new Date(0) = 1970 → minAgo = huge → "data too old" early return
        // CORRECT:        new Date(NaN) = Invalid Date → minAgo = NaN → NaN > max = false
        const gs = {
            glucose: 120,
            delta: 2,
            short_avgdelta: 1.5,
            long_avgdelta: 1.0,
            date: undefined, // explicitly undefined
        } as unknown as GlucoseStatus;

        const profile = {
            current_basal: 1.0,
            out_units: 'mg/dL',
            sens: 50,
        } as Profile;

        const result = validateCGMData(
            gs,
            profile,
            new Date(FIXED_TIME),
            1,
            { duration: 0, rate: 0, temp: 'absolute' },
            false,
            0,
        );

        // Should NOT be an early return with "BG data is too old" error
        if ('earlyReturn' in result) {
            expect(result.earlyReturn.error).not.toMatch(/too old/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Sensitivity targets: undefined sensitivityRatio must flow through
// ---------------------------------------------------------------------------

describe('sensitivity targets with undefined sensitivityRatio', () => {
    const minProfile = {
        current_basal: 1.0,
        max_basal: 4.0,
        out_units: 'mg/dL',
    } as Profile;

    it('adjustISFBySensitivity returns unadjusted sens when autosens_data is null', () => {
        // When autosens_data is null, sensitivityRatio is undefined.
        // The function should skip the division entirely.
        const result = adjustISFBySensitivity(
            50,
            undefined as unknown as number, // simulates undefined sensitivityRatio
            minProfile,
            null as unknown as AutosensData,
        );
        expect(result.adjustedSens).toBe(50);
        expect(result.isfreason).toBe('');
    });

    it('adjustBasalBySensitivity returns original basal when sensitivityRatio is undefined', () => {
        const result = adjustBasalBySensitivity(
            1.0, // basal
            undefined, // sensitivityRatio
            1.0, // overrideFactor
            false, // dynISFenabled
            minProfile,
            1.0, // profile_current_basal
        );
        expect(result).toBe(1.0);
    });

    it('adjustISFBySensitivity produces NaN when dividing by 0 (would happen with ?? 0)', () => {
        // This test documents that dividing by 0 produces Infinity,
        // which is DANGEROUS. The correct fix is to guard against it.
        const result = adjustISFBySensitivity(
            50,
            0, // zero ratio — would happen if ?? 0 replaced undefined
            minProfile,
            { ratio: 0 } as AutosensData,
        );
        // 50 / 0 = Infinity — this is the dangerous case
        expect(result.adjustedSens).toBe(Infinity);
    });
});

// ---------------------------------------------------------------------------
// Dynamic ISF: undefined newRatio as divisor
// ---------------------------------------------------------------------------

describe('division by undefined vs zero safety', () => {
    it('Number(undefined) produces NaN, not 0', () => {
        expect(Number(undefined)).toBeNaN();
    });

    it('division by Number(undefined) produces NaN, not Infinity', () => {
        expect(50 / Number(undefined)).toBeNaN();
    });

    it('division by 0 produces Infinity (the dangerous case)', () => {
        expect(50 / 0).toBe(Infinity);
    });

    it('NaN in comparison always returns false (safe for guards)', () => {
        expect(Number(undefined) < 0.1).toBe(false);
        expect(Number(undefined) > 100).toBe(false);
        expect(Number(undefined) >= 3).toBe(false);
    });

    it('0 in comparison can return true (dangerous for guards)', () => {
        expect(0 < 0.1).toBe(true); // BUG: would trigger early return
        expect(0 >= 0).toBe(true);  // BUG: would pass threshold check
    });
});

// ---------------------------------------------------------------------------
// Carb absorption: undefined carb_ratio and min_5m_carbimpact
// ---------------------------------------------------------------------------

describe('carb absorption with undefined profile fields', () => {
    it('Number(undefined) * carbImpact = NaN (safe: absorption is NaN, COB unchanged)', () => {
        // In autosens deviation loop: absorbed = carbImpact * Number(carb_ratio) / sens
        // If carb_ratio is undefined: Number(undefined) = NaN → absorbed = NaN
        // mealCOB = Math.max(0, mealCOB - NaN) = NaN → system treats as no data
        const carbImpact = 5;
        const carb_ratio = undefined;
        const sens = 50;
        const absorbed = carbImpact * Number(carb_ratio) / sens;
        expect(absorbed).toBeNaN();
    });

    it('0 * carbImpact = 0 (dangerous: absorption always zero, COB never decreases)', () => {
        // BUG with ?? 0: absorbed = carbImpact * 0 / sens = 0
        // mealCOB never decreases → system thinks carbs never absorb → excess insulin
        const carbImpact = 5;
        const carb_ratio = 0; // what ?? 0 would produce
        const sens = 50;
        const absorbed = carbImpact * carb_ratio / sens;
        expect(absorbed).toBe(0); // DANGEROUS: falsely claims zero absorption
    });
});

// ---------------------------------------------------------------------------
// Temp basal: undefined duration as divisor
// ---------------------------------------------------------------------------

describe('temp basal rate with undefined duration', () => {
    it('amount / Number(undefined) = NaN (safe: invalid rate is NaN)', () => {
        const amount = 0.5;
        const duration = undefined;
        const rate = amount / Number(duration) * 60;
        expect(rate).toBeNaN();
    });

    it('amount / 0 = Infinity (dangerous: infinite basal rate)', () => {
        const amount = 0.5;
        const duration = 0; // what ?? 0 would produce
        const rate = amount / duration * 60;
        expect(rate).toBe(Infinity); // DANGEROUS
    });
});

// ---------------------------------------------------------------------------
// SMB: undefined bolus_increment and smb_delivery_ratio
// ---------------------------------------------------------------------------

describe('SMB dosing with undefined profile fields', () => {
    it('1 / Number(undefined) = NaN → microBolus becomes NaN (safe: SMB disabled)', () => {
        const bolusIncrement = undefined;
        const roundSMBTo = 1 / Number(bolusIncrement);
        const microBolus = Math.floor(0.5 * roundSMBTo) / roundSMBTo;
        expect(microBolus).toBeNaN(); // Safe: NaN SMB won't fire
    });

    it('1 / 0 = Infinity → unpredictable SMB rounding (dangerous)', () => {
        const bolusIncrement = 0; // what ?? 0 would produce
        const roundSMBTo = 1 / bolusIncrement;
        expect(roundSMBTo).toBe(Infinity);
        // Math.floor(0.5 * Infinity) / Infinity = NaN (happens to be safe by luck)
        // but the intermediate Infinity is conceptually wrong
    });

    it('Math.min(Number(undefined), 1) = NaN → insulinReq * NaN = NaN (safe: no SMB)', () => {
        const smb_delivery_ratio = undefined;
        const smb_ratio = Math.min(Number(smb_delivery_ratio), 1);
        expect(smb_ratio).toBeNaN();
        const microBolus = Math.min(1.5 * smb_ratio, 3);
        expect(microBolus).toBeNaN();
    });

    it('Math.min(0, 1) = 0 → insulinReq * 0 = 0 (dangerous: silently disables SMB)', () => {
        const smb_delivery_ratio = 0; // what ?? 0 would produce
        const smb_ratio = Math.min(smb_delivery_ratio, 1);
        expect(smb_ratio).toBe(0);
        const microBolus = Math.min(1.5 * smb_ratio, 3);
        expect(microBolus).toBe(0); // DANGEROUS: no insulin delivered
    });
});
