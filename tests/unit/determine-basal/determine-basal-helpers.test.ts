import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    validateIOBAndTemps,
    calculateDeviation,
} from '../../../src/determine-basal/helpers';

import type {
    IOBData,
    CurrentTemp,
    Profile,
    TempBasalFunctions,
    DetermineBasalResult,
} from '../../../src/types/index';

// ---------------------------------------------------------------------------
// Console mocking
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeProfile(): Profile {
    return {
        current_basal: 1.0,
        out_units: 'mg/dL',
        sens: 50,
    } as Profile;
}

function makeIOBData(overrides: Partial<IOBData> = {}): IOBData {
    return {
        iob: 2.0,
        activity: 0.05,
        basaliob: 0.5,
        bolusiob: 1.5,
        netbasalinsulin: 0.5,
        bolusinsulin: 3.0,
        time: new Date('2025-01-15T12:00:00Z'),
        lastBolusTime: Date.now() - 600000,
        ...overrides,
    } as IOBData;
}

function makeIOBArray(...overrides: Partial<IOBData>[]): IOBData[] {
    if (overrides.length === 0) return [makeIOBData()];
    return overrides.map(o => makeIOBData(o));
}

function makeTempBasalFunctions(): TempBasalFunctions {
    return {
        setTempBasal: vi.fn(
            (
                _rate: number,
                _duration: number,
                _profile: Profile,
                result: DetermineBasalResult,
            ) => result,
        ),
        getMaxSafeBasal: vi.fn(() => 4),
    } as unknown as TempBasalFunctions;
}

// ---------------------------------------------------------------------------
// validateIOBAndTemps
// ---------------------------------------------------------------------------

describe('validateIOBAndTemps', () => {
    it('returns earlyReturn when iob_data is undefined', () => {
        const result = { reason: '' } as DetermineBasalResult;
        const outcome = validateIOBAndTemps(
            undefined as unknown as IOBData[],
            { rate: 0, duration: 0 } as CurrentTemp,
            makeProfile(),
            new Date('2025-01-15T12:00:00Z'),
            true,
            makeTempBasalFunctions(),
            result,
            new Date('2025-01-15T12:00:00Z'),
        );

        expect('earlyReturn' in outcome).toBe(true);
        if ('earlyReturn' in outcome) {
            expect(outcome.earlyReturn.error).toContain('iob_data undefined');
        }
    });

    it('returns earlyReturn when iob_data.activity is undefined', () => {
        const result = { reason: '' } as DetermineBasalResult;
        const iob = makeIOBData();
        (iob as unknown as Record<string, unknown>).activity = undefined;

        const outcome = validateIOBAndTemps(
            [iob],
            { rate: 0, duration: 0 } as CurrentTemp,
            makeProfile(),
            new Date('2025-01-15T12:00:00Z'),
            true,
            makeTempBasalFunctions(),
            result,
            new Date('2025-01-15T12:00:00Z'),
        );

        expect('earlyReturn' in outcome).toBe(true);
        if ('earlyReturn' in outcome) {
            expect(outcome.earlyReturn.error).toContain('missing some property');
        }
    });

    it('extracts first element from iobArray when length > 1', () => {
        const result = { reason: '' } as DetermineBasalResult;

        const outcome = validateIOBAndTemps(
            makeIOBArray({ iob: 1.5 }, { iob: 3.0 }),
            { rate: 0, duration: 0 } as CurrentTemp,
            makeProfile(),
            new Date('2025-01-15T12:00:00Z'),
            false,
            makeTempBasalFunctions(),
            result,
            new Date('2025-01-15T12:00:00Z'),
        );

        expect('iob_data' in outcome).toBe(true);
        if ('iob_data' in outcome) {
            expect(outcome.iob_data.iob).toBe(1.5);
            expect(outcome.iobArray).toHaveLength(2);
        }
    });

    it('sets result.temp and result.deliverAt on success', () => {
        const result = { reason: '' } as DetermineBasalResult;
        const deliverAt = new Date('2025-01-15T12:05:00Z');

        const outcome = validateIOBAndTemps(
            makeIOBArray(),
            { rate: 0, duration: 0 } as CurrentTemp,
            makeProfile(),
            new Date('2025-01-15T12:00:00Z'),
            false,
            makeTempBasalFunctions(),
            result,
            deliverAt,
        );

        expect('iob_data' in outcome).toBe(true);
        expect(result.temp).toBe('absolute');
        expect(result.deliverAt).toBeDefined();
    });

    it('cancels temp when currenttemp rate differs from lastTemp rate (microBolus mode)', () => {
        const result = { reason: '' } as DetermineBasalResult;
        const tempFns = makeTempBasalFunctions();

        const outcome = validateIOBAndTemps(
            makeIOBArray({
                lastTemp: { rate: 1.0, duration: 30, date: Date.now() - 15 * 60 * 1000 },
            } as Partial<IOBData>),
            { rate: 2.0, duration: 20 } as CurrentTemp,
            makeProfile(),
            new Date(),
            true,
            tempFns,
            result,
            new Date(),
        );

        expect('earlyReturn' in outcome).toBe(true);
        if ('earlyReturn' in outcome) {
            expect(outcome.earlyReturn.reason).toContain('canceling temp');
        }
        expect(tempFns.setTempBasal).toHaveBeenCalledWith(0, 0, expect.anything(), expect.anything(), expect.anything());
    });

    it('cancels temp when lastTemp ended too long ago', () => {
        const result = { reason: '' } as DetermineBasalResult;
        const tempFns = makeTempBasalFunctions();

        // lastTemp set 20 minutes ago with 5 minute duration → ended 15 minutes ago (> TEMP_END_GAP_MINUTES=5)
        const outcome = validateIOBAndTemps(
            makeIOBArray({
                lastTemp: { rate: 1.0, duration: 5, date: Date.now() - 20 * 60 * 1000 },
            } as Partial<IOBData>),
            { rate: 1.0, duration: 10 } as CurrentTemp,
            makeProfile(),
            new Date(),
            false,
            tempFns,
            result,
            new Date(),
        );

        expect('earlyReturn' in outcome).toBe(true);
        if ('earlyReturn' in outcome) {
            expect(outcome.earlyReturn.reason).toContain('lastTemp from pumphistory ended');
        }
    });

    it('returns iob_data and iobArray on successful validation', () => {
        const result = { reason: '' } as DetermineBasalResult;

        const outcome = validateIOBAndTemps(
            makeIOBArray(),
            { rate: 0, duration: 0 } as CurrentTemp,
            makeProfile(),
            new Date('2025-01-15T12:00:00Z'),
            false,
            makeTempBasalFunctions(),
            result,
            new Date('2025-01-15T12:00:00Z'),
        );

        expect('iob_data' in outcome).toBe(true);
        if ('iob_data' in outcome) {
            expect(outcome.iob_data).toBeDefined();
            expect(outcome.iobArray).toBeDefined();
        }
    });
});

// ---------------------------------------------------------------------------
// calculateDeviation
// ---------------------------------------------------------------------------

describe('calculateDeviation', () => {
    const iob = makeIOBData({ iob: 2.0 });

    it('computes positive deviation from positive minDelta', () => {
        // bgImpact = -2 (BG falling), minDelta = 5 (BG actually rising)
        // deviation = round(30/5 * (5 - (-2))) = round(6 * 7) = 42
        const result = calculateDeviation(150, iob, 50, 50, 5, 3, 1, -2);
        expect(result.deviation).toBe(42);
    });

    it('falls back to minAvgDelta when minDelta deviation is negative', () => {
        // bgImpact = 5, minDelta = 2 → deviation = round(6 * (2 - 5)) = -18 (negative)
        // Falls back to minAvgDelta = 4 → deviation = round(6 * (4 - 5)) = -6 (still negative)
        // Falls back to long_avgdelta = 6 → deviation = round(6 * (6 - 5)) = 6
        const result = calculateDeviation(150, iob, 50, 50, 2, 4, 6, 5);
        expect(result.deviation).toBe(6);
    });

    it('falls back to long_avgdelta when minAvgDelta deviation is also negative', () => {
        // bgImpact = 5, minDelta = 1 → negative, minAvgDelta = 3 → negative, long_avgdelta = 4 → negative
        // deviation = round(6 * (4 - 5)) = -6
        const result = calculateDeviation(150, iob, 50, 50, 1, 3, 4, 5);
        expect(result.deviation).toBe(-6);
    });

    it('stops at minAvgDelta when minDelta deviation is negative but minAvgDelta deviation is non-negative', () => {
        // bgImpact = 3, minDelta = 1 → deviation = round(6 * (1 - 3)) = round(-12) = -12 (negative)
        // Falls back to minAvgDelta = 4 → deviation = round(6 * (4 - 3)) = round(6) = 6 (non-negative, stops here)
        // Does NOT fall through to long_avgdelta
        const result = calculateDeviation(150, iob, 50, 50, 1, 4, 10, 3);
        expect(result.deviation).toBe(6);
    });

    it('computes naive_eventualBG using adjustedSens for positive IOB', () => {
        // bg=150, iob=2.0 > 0, adjustedSens=50
        // naive_eventualBG = round(150 - 2.0 * 50) = round(50) = 50
        const result = calculateDeviation(150, makeIOBData({ iob: 2.0 }), 50, 40, 0, 0, 0, 0);
        expect(result.naive_eventualBG).toBe(50);
    });

    it('uses min(adjustedSens, sensitivity) for negative IOB', () => {
        // bg=150, iob=-1.0, adjustedSens=50, sensitivity=40
        // naive_eventualBG = round(150 - (-1.0) * min(50, 40)) = round(150 + 40) = 190
        const result = calculateDeviation(150, makeIOBData({ iob: -1.0 }), 50, 40, 0, 0, 0, 0);
        expect(result.naive_eventualBG).toBe(190);
    });

    it('computes eventualBG = naive_eventualBG + deviation', () => {
        // bg=150, iob=2.0, adjustedSens=50 → naive_eventualBG = 50
        // bgImpact = -2, minDelta = 5 → deviation = 42
        // eventualBG = 50 + 42 = 92
        const result = calculateDeviation(150, makeIOBData({ iob: 2.0 }), 50, 50, 5, 3, 1, -2);
        expect(result.eventualBG).toBe(result.naive_eventualBG + result.deviation);
    });

    it('returns zero deviation when minDelta equals bgImpact', () => {
        // minDelta = bgImpact → deviation = round(6 * (3 - 3)) = 0
        const result = calculateDeviation(150, iob, 50, 50, 3, 3, 3, 3);
        expect(result.deviation).toBe(0);
    });
});
