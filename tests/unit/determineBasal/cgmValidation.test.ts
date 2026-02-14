import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validateCGMData } from '../../../src/determineBasal/cgmValidation';

import type { CurrentTemp, Profile } from '../../../src/types/index';

import {
    makeGlucoseStatus,
    makeProfile,
    FIXED_TIME,
} from '../../unit/helpers';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// validateCGMData
// ---------------------------------------------------------------------------

describe('validateCGMData', () => {
    it('returns earlyReturn with error when profile is undefined', () => {
        const result = validateCGMData(
            makeGlucoseStatus(),
            undefined as unknown as Profile,
            new Date(FIXED_TIME),
            1.0,
            { rate: 0, duration: 0 } as CurrentTemp,
            false,
            0,
        );

        expect('earlyReturn' in result).toBe(true);
        if ('earlyReturn' in result) {
            expect(result.earlyReturn.error).toBe('Error: could not get current basal rate');
        }
    });

    it('returns earlyReturn with error when profile.current_basal is undefined', () => {
        const profileWithoutBasal = makeProfile();
        (profileWithoutBasal as unknown as Record<string, unknown>).current_basal = undefined;

        const result = validateCGMData(
            makeGlucoseStatus(),
            profileWithoutBasal,
            new Date(FIXED_TIME),
            1.0,
            { rate: 0, duration: 0 } as CurrentTemp,
            false,
            0,
        );

        expect('earlyReturn' in result).toBe(true);
        if ('earlyReturn' in result) {
            expect(result.earlyReturn.error).toBe('Error: could not get current basal rate');
        }
    });

    it('returns validated CGM values for valid inputs', () => {
        const result = validateCGMData(
            makeGlucoseStatus(),
            makeProfile(),
            new Date(FIXED_TIME),
            1.0,
            { rate: 0, duration: 0 } as CurrentTemp,
            false,
            0,
        );

        expect('earlyReturn' in result).toBe(false);
        if (!('earlyReturn' in result)) {
            expect(result.bg).toBe(120);
            expect(result.basal).toBe(1.0);
            expect(result.profileCurrentBasal).toBe(1.0);
        }
    });

    it('returns earlyReturn when BG is in error range (bg <= 10)', () => {
        const result = validateCGMData(
            makeGlucoseStatus({ glucose: 5 }),
            makeProfile(),
            new Date(FIXED_TIME),
            1.0,
            { rate: 0, duration: 0 } as CurrentTemp,
            false,
            0,
        );

        expect('earlyReturn' in result).toBe(true);
    });
});
