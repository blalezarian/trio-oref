import { describe, it, beforeEach, expect, vi } from 'vitest';
import type { CarbTreatment } from '../../../src/types/index';
import type { IobProfile, HistoryBasalProfileEntry } from '../../../src/iob/types';

// Mock detectCarbAbsorption before importing the module under test
vi.mock('../../../src/cob/index', () => ({
    detectCarbAbsorption: vi.fn(),
}));

// Import after mock setup
import recentCarbs, {
    round,
    resolveMaxAbsorptionTime,
    accumulateCarbsByType,
} from '../../../src/meal/total';
import { detectCarbAbsorption } from '../../../src/cob/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const FIXED_DATE = new Date(FIXED_TIME);

const mockedCalcMealCOB = vi.mocked(detectCarbAbsorption);

function makeProfile(overrides: Partial<IobProfile> = {}): IobProfile {
    return {
        dia: 5,
        basalprofile: [],
        current_basal: 1.0,
        maxMealAbsorptionTime: 6,
        maxCOB: 120,
        sens: 50,
        carb_ratio: 10,
        min_5m_carbimpact: 8,
        ...overrides,
    };
}

function makeBasalProfile(): HistoryBasalProfileEntry[] {
    return [{ i: 0, start: '00:00:00', rate: 1.0, minutes: 0 }];
}

function makeTreatment(overrides: Partial<CarbTreatment> = {}): CarbTreatment {
    return {
        timestamp: FIXED_TIME,
        carbs: 30,
        nsCarbs: 30,
        ...overrides,
    };
}

function makeOpts(
    treatments: CarbTreatment[] | null,
    profileOverrides: Partial<IobProfile> = {},
) {
    return {
        treatments,
        profile: makeProfile(profileOverrides),
        pumphistory: [],
        glucose: [],
        basalprofile: makeBasalProfile(),
    };
}

/** Helper: configure the mock to return standard absorption data */
function mockAbsorption(carbsAbsorbed: number, overrides: Partial<{
    currentDeviation: number;
    maxDeviation: number;
    minDeviation: number;
    slopeFromMaxDeviation: number;
    slopeFromMinDeviation: number;
    allDeviations: number[];
}> = {}) {
    mockedCalcMealCOB.mockReturnValue({
        carbsAbsorbed,
        currentDeviation: overrides.currentDeviation ?? 5.0,
        maxDeviation: overrides.maxDeviation ?? 10.0,
        minDeviation: overrides.minDeviation ?? -2.0,
        slopeFromMaxDeviation: overrides.slopeFromMaxDeviation ?? -0.5,
        slopeFromMinDeviation: overrides.slopeFromMinDeviation ?? 0.3,
        allDeviations: overrides.allDeviations ?? [5, 10, -2],
    });
}

// ---------------------------------------------------------------------------
// round
// ---------------------------------------------------------------------------

describe('round', () => {
    it('rounds to 0 decimal places by default', () => {
        expect(round(3.7)).toBe(4);
        expect(round(3.2)).toBe(3);
    });

    it('rounds to specified decimal places', () => {
        expect(round(3.14159, 2)).toBe(3.14);
        expect(round(3.14159, 3)).toBe(3.142);
    });

    it('handles zero', () => {
        expect(round(0, 2)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// resolveMaxAbsorptionTime
// ---------------------------------------------------------------------------

describe('resolveMaxAbsorptionTime', () => {
    it('returns profile value when it is a valid number', () => {
        const profile = makeProfile({ maxMealAbsorptionTime: 4 });
        expect(resolveMaxAbsorptionTime(profile)).toBe(4);
    });

    it('returns default (6) when profile value is NaN', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const profile = makeProfile({ maxMealAbsorptionTime: NaN });
        expect(resolveMaxAbsorptionTime(profile)).toBe(6);
        spy.mockRestore();
    });

    it('returns default (6) when profile value is undefined', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const profile = makeProfile({ maxMealAbsorptionTime: undefined as unknown as number });
        expect(resolveMaxAbsorptionTime(profile)).toBe(6);
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// accumulateCarbsByType
// ---------------------------------------------------------------------------

describe('accumulateCarbsByType', () => {
    it('accumulates nsCarbs', () => {
        const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
        accumulateCarbsByType({ timestamp: '', carbs: 30, nsCarbs: 30 }, totals);
        expect(totals.nsCarbs).toBe(30);
        expect(totals.bwFound).toBe(false);
    });

    it('accumulates bwCarbs and sets bwFound', () => {
        const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
        accumulateCarbsByType({ timestamp: '', carbs: 25, bwCarbs: 25 }, totals);
        expect(totals.bwCarbs).toBe(25);
        expect(totals.bwFound).toBe(true);
    });

    it('accumulates journalCarbs', () => {
        const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
        accumulateCarbsByType({ timestamp: '', carbs: 20, journalCarbs: 20 }, totals);
        expect(totals.journalCarbs).toBe(20);
    });

    it('logs error for unclassified carbs', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
        accumulateCarbsByType({ timestamp: '', carbs: 10 }, totals);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('Treatment carbs unclassified:'));
        spy.mockRestore();
    });

    it('prioritizes nsCarbs over bwCarbs when both present', () => {
        const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
        accumulateCarbsByType({ timestamp: '', carbs: 30, nsCarbs: 30, bwCarbs: 30 }, totals);
        expect(totals.nsCarbs).toBe(30);
        expect(totals.bwCarbs).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// recentCarbs
// ---------------------------------------------------------------------------

describe('recentCarbs', () => {

    beforeEach(() => {
        mockedCalcMealCOB.mockReset();
    });

    // --- null treatments ---

    it('returns empty object when treatments is null', () => {
        const result = recentCarbs(makeOpts(null), FIXED_DATE);
        expect(result).toEqual({});
    });

    // --- Single carb treatment ---

    it('counts carbs and computes COB for a single treatment', () => {
        // Treatment 30g nsCarbs, 10g absorbed => 20g COB
        mockAbsorption(10);

        const treatments = [makeTreatment({ timestamp: '2025-01-15T11:00:00.000Z' })];
        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);

        expect(result).toHaveProperty('carbs');
        expect((result as { carbs: number }).carbs).toBe(30);
        expect((result as { nsCarbs: number }).nsCarbs).toBe(30);
        expect((result as { mealCOB: number }).mealCOB).toBe(20);
    });

    // --- Treatment outside maxMealAbsorptionTime window ---

    it('ignores treatment outside maxMealAbsorptionTime window', () => {
        mockAbsorption(0);

        // Treatment 7 hours ago, with maxMealAbsorptionTime = 6
        const oldTimestamp = '2025-01-15T05:00:00.000Z'; // 7 hours before FIXED_TIME
        const treatments = [makeTreatment({ timestamp: oldTimestamp })];
        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);

        expect((result as { carbs: number }).carbs).toBe(0);
        expect((result as { mealCOB: number }).mealCOB).toBe(0);
    });

    it('ignores treatment in the future', () => {
        mockAbsorption(0);

        const futureTimestamp = '2025-01-15T12:05:00.000Z'; // 5 min in the future
        const treatments = [makeTreatment({ timestamp: futureTimestamp })];
        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);

        expect((result as { carbs: number }).carbs).toBe(0);
    });

    // --- Multiple treatments with carbsToRemove logic ---

    it('removes carbs from fully absorbed earlier meals', () => {
        // Two treatments: older meal already absorbed, newer meal partially absorbed
        // Sorted newest first by recentCarbs
        const t1 = '2025-01-15T08:00:00.000Z'; // 4h ago - older
        const t2 = '2025-01-15T11:00:00.000Z'; // 1h ago - newer

        const treatments = [
            makeTreatment({ timestamp: t1, carbs: 40, nsCarbs: 40 }),
            makeTreatment({ timestamp: t2, carbs: 20, nsCarbs: 20 }),
        ];

        // First call (newer treatment, t2): 5g absorbed of 20g total => COB=15
        // Second call (older treatment, t1): 55g absorbed of 60g total => COB=5 < 15 (mealCOB)
        // Since myMealCOB(5) < mealCOB(15), the older carbs are flagged for removal
        mockedCalcMealCOB
            .mockReturnValueOnce({
                carbsAbsorbed: 5,
                currentDeviation: 5,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            })
            .mockReturnValueOnce({
                carbsAbsorbed: 55,
                currentDeviation: 5,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            })
            // Final deviation calculation call
            .mockReturnValue({
                carbsAbsorbed: 0,
                currentDeviation: 3,
                maxDeviation: 8,
                minDeviation: -1,
                slopeFromMaxDeviation: -0.4,
                slopeFromMinDeviation: 0.2,
                allDeviations: [3, 8, -1],
            });

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { carbs: number; nsCarbs: number; mealCOB: number };

        // Older meal's 40g should be subtracted (carbsToRemove)
        expect(r.carbs).toBe(20);
        expect(r.nsCarbs).toBe(20);
        expect(r.mealCOB).toBe(15);
    });

    // --- maxCOB cap enforcement ---

    it('caps mealCOB at profile.maxCOB', () => {
        // Treatment with large COB that should be capped
        const treatments = [
            makeTreatment({
                timestamp: '2025-01-15T11:30:00.000Z',
                carbs: 200,
                nsCarbs: 200,
            }),
        ];

        // 0 absorbed => COB = 200, but maxCOB = 120, so capped at 120
        mockAbsorption(0);

        const result = recentCarbs(makeOpts(treatments, { maxCOB: 120 }), FIXED_DATE);
        const r = result as { mealCOB: number };

        expect(r.mealCOB).toBe(120);
    });

    it('does not cap when mealCOB is below maxCOB', () => {
        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T11:30:00.000Z', carbs: 50, nsCarbs: 50 }),
        ];
        mockAbsorption(10);

        const result = recentCarbs(makeOpts(treatments, { maxCOB: 120 }), FIXED_DATE);
        const r = result as { mealCOB: number };

        expect(r.mealCOB).toBe(40);
    });

    // --- bwCarbs categorization ---

    it('categorizes bwCarbs and sets bwFound', () => {
        mockAbsorption(5);

        const treatments: CarbTreatment[] = [{
            timestamp: '2025-01-15T11:00:00.000Z',
            carbs: 30,
            bwCarbs: 30,
        }];

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { bwCarbs: number; bwFound: boolean; nsCarbs: number };

        expect(r.bwCarbs).toBe(30);
        expect(r.bwFound).toBe(true);
        expect(r.nsCarbs).toBe(0);
    });

    // --- journalCarbs categorization ---

    it('categorizes journalCarbs', () => {
        mockAbsorption(5);

        const treatments: CarbTreatment[] = [{
            timestamp: '2025-01-15T11:00:00.000Z',
            carbs: 25,
            journalCarbs: 25,
        }];

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { journalCarbs: number; nsCarbs: number; bwCarbs: number };

        expect(r.journalCarbs).toBe(25);
        expect(r.nsCarbs).toBe(0);
        expect(r.bwCarbs).toBe(0);
    });

    // --- Zombie-carb safety: null currentDeviation sets mealCOB=0 ---

    it('sets mealCOB to 0 when currentDeviation is null', () => {
        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T11:30:00.000Z' }),
        ];

        // First call: for meal COB computation
        mockedCalcMealCOB
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: 5,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            })
            // Second call: deviation calculation — null currentDeviation
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: null as unknown as number,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            });

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { mealCOB: number };

        expect(r.mealCOB).toBe(0);
    });

    it('sets mealCOB to 0 when maxDeviation is null', () => {
        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T11:30:00.000Z' }),
        ];

        mockedCalcMealCOB
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: 5,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            })
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: 5,
                maxDeviation: null as unknown as number,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            });

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { mealCOB: number };

        expect(r.mealCOB).toBe(0);
    });

    it('sets mealCOB to 0 when currentDeviation is undefined', () => {
        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T11:30:00.000Z' }),
        ];

        mockedCalcMealCOB
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: 5,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            })
            .mockReturnValueOnce({
                carbsAbsorbed: 0,
                currentDeviation: undefined as unknown as number,
                maxDeviation: 10,
                minDeviation: -2,
                slopeFromMaxDeviation: -0.5,
                slopeFromMinDeviation: 0.3,
                allDeviations: [5, 10, -2],
            });

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { mealCOB: number };

        expect(r.mealCOB).toBe(0);
    });

    // --- lastCarbTime ---

    it('tracks lastCarbTime as the most recent carb treatment time', () => {
        const t1 = '2025-01-15T10:00:00.000Z';
        const t2 = '2025-01-15T11:00:00.000Z';

        mockAbsorption(5);

        const treatments = [
            makeTreatment({ timestamp: t1, carbs: 20, nsCarbs: 20 }),
            makeTreatment({ timestamp: t2, carbs: 30, nsCarbs: 30 }),
        ];

        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as { lastCarbTime: number };

        // lastCarbTime should be the epoch ms of the more recent treatment
        expect(r.lastCarbTime).toBe(new Date(t2).getTime());
    });

    // --- Rounding ---

    it('rounds output values to expected precision', () => {
        mockAbsorption(10.1234567);

        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T11:00:00.000Z', carbs: 30, nsCarbs: 30 }),
        ];
        const result = recentCarbs(makeOpts(treatments), FIXED_DATE);
        const r = result as {
            carbs: number;
            nsCarbs: number;
            mealCOB: number;
            currentDeviation: number;
            slopeFromMaxDeviation: number;
        };

        // carbs rounded to 3 decimal places
        expect(r.carbs).toBe(30);
        // mealCOB rounded to integer
        expect(r.mealCOB).toBe(Math.round(30 - 10.1234567));
        // currentDeviation rounded to 2 decimal places
        expect(r.currentDeviation).toBe(5);
        // slopeFromMaxDeviation rounded to 3 decimal places
        expect(r.slopeFromMaxDeviation).toBe(-0.5);
    });

    // --- Empty treatments array ---

    it('returns zeros for empty treatments array', () => {
        mockAbsorption(0);

        const result = recentCarbs(makeOpts([]), FIXED_DATE);
        const r = result as { carbs: number; mealCOB: number; nsCarbs: number };

        expect(r.carbs).toBe(0);
        expect(r.nsCarbs).toBe(0);
        expect(r.mealCOB).toBe(0);
    });

    // --- Custom maxMealAbsorptionTime ---

    it('uses profile maxMealAbsorptionTime for the carb window', () => {
        mockAbsorption(0);

        // Treatment 3 hours ago, maxMealAbsorptionTime = 2 => should be excluded
        const treatments = [
            makeTreatment({ timestamp: '2025-01-15T09:00:00.000Z', carbs: 40, nsCarbs: 40 }),
        ];
        const result = recentCarbs(makeOpts(treatments, { maxMealAbsorptionTime: 2 }), FIXED_DATE);
        const r = result as { carbs: number };

        expect(r.carbs).toBe(0);
    });
});
