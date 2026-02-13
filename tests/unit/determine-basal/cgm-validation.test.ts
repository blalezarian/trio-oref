import { describe, it, expect, vi, beforeEach } from 'vitest';

import { validateCGMData } from '../../../src/determine-basal/cgm-validation';

import type {
    GlucoseStatus,
    CurrentTemp,
    Profile,
} from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeGlucoseStatus(overrides: Partial<GlucoseStatus> = {}): GlucoseStatus {
    return {
        glucose: 120,
        delta: 2,
        short_avgdelta: 1.5,
        long_avgdelta: 1.0,
        date: new Date(FIXED_TIME).getTime() - 60000, // 1 minute ago
        ...overrides,
    } as GlucoseStatus;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
    return {
        current_basal: 1.0,
        out_units: 'mg/dL',
        sens: 50,
        ...overrides,
    } as Profile;
}

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
            expect(result.profile_current_basal).toBe(1.0);
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
