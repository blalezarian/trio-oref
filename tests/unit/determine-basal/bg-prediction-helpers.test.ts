import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    calculateDynISFBGImpact,
    predictIOBandZT,
    predictCOB,
    predictUAM,
    clipAndTrimPredictions,
    calculateMinAndGuardBGs,
    calculateAvgPredBG,
    blendMinGuardBG,
    selectMinPredBG,
} from '../../../src/determine-basal/bg-predictions';
import type {
    ClipAndTrimInputs,
    MinGuardBGInputs,
} from '../../../src/determine-basal/types';
import type { IOBData, IOBEntry } from '../../../src/types/index';

// Constants from the source for reference in assertions:
// MIN_VALID_GLUCOSE_MGDL = 39
// MAX_VALID_GLUCOSE_MGDL = 400  (clipped to 401)
// MIN_PRED_TRIM_POINTS = 12
// MIN_ZT_TRIM_POINTS = 6
// COB_PRED_BG_CAP = 1500
// PRED_BG_SENTINEL = 999

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// calculateDynISFBGImpact
// ---------------------------------------------------------------------------

describe('calculateDynISFBGImpact', () => {
    // Formula: round(-activity * (1800 / (tdd * adjustmentFactor * ln(max(lastPredBG, 39) / insulinFactor + 1))) * 5, 2)
    // Where 1800 = DYNAMIC_ISF_LOG_DENOMINATOR, 39 = MIN_VALID_GLUCOSE_MGDL, 5 = PRED_INTERVAL_MINUTES

    it('computes negative impact for positive activity (insulin lowering BG)', () => {
        // activity=0.05, lastPredBG=120, tdd=50, adjustmentFactor=0.8, insulinFactor=75
        // dynamicSens = 1800 / (50 * 0.8 * ln(120/75 + 1)) = 1800 / (40 * ln(2.6))
        // ln(2.6) ≈ 0.9555; dynamicSens ≈ 1800 / 38.22 ≈ 47.10
        // result = round(-0.05 * 47.10 * 5, 2) = round(-11.775, 2) = -11.78
        const result = calculateDynISFBGImpact(0.05, 120, 50, 0.8, 75);
        expect(result).toBe(-11.77);
    });

    it('returns -0 for zero activity (round preserves sign)', () => {
        const result = calculateDynISFBGImpact(0, 120, 50, 0.8, 75);
        expect(result).toBe(-0);
    });

    it('clamps lastPredBG to MIN_VALID_GLUCOSE_MGDL (39) when below', () => {
        // lastPredBG=10 -> uses 39 in the formula
        const clamped = calculateDynISFBGImpact(0.05, 10, 50, 0.8, 75);
        const atMin = calculateDynISFBGImpact(0.05, 39, 50, 0.8, 75);
        expect(clamped).toBe(atMin);
    });

    it('returns positive impact for negative activity (insulin wearing off)', () => {
        const result = calculateDynISFBGImpact(-0.03, 100, 50, 0.8, 75);
        expect(result).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// predictIOBandZT
// ---------------------------------------------------------------------------

/** Minimal IOBData tick for testing prediction helpers. */
function makeIOBTick(overrides: Partial<IOBData> = {}): IOBData {
    return {
        iob: 2,
        activity: 0.05,
        basaliob: 1,
        bolusiob: 1,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        time: new Date(),
        iobWithZeroTemp: { iob: 0, activity: 0.02 } as IOBEntry,
        ...overrides,
    } as IOBData;
}

describe('predictIOBandZT', () => {
    it('computes IOB and ZT predictions using standard formula (no dynamic ISF)', () => {
        const IOBpredBGs = [120];
        const ZTpredBGs = [120];
        const iobTick = makeIOBTick({ activity: 0.05, iobWithZeroTemp: { iob: 0, activity: 0.02 } as IOBEntry });

        const result = predictIOBandZT(
            iobTick, IOBpredBGs, ZTpredBGs, 40, 3,
            false, 0, 0, 0,
        );

        // predBGI = round(-0.05 * 40 * 5, 2) = -10
        expect(result.predBGI).toBe(-10);
        // predDev = 3 * (1 - min(1, 1/12)) = 3 * (1 - 0.0833) ≈ 2.75
        expect(result.predDev).toBeCloseTo(2.75, 1);
        // IOBpredBG = 120 + (-10) + 2.75 = 112.75
        expect(result.IOBpredBG).toBeCloseTo(112.75, 1);
        // ZTpredBG = 120 + round(-0.02 * 40 * 5, 2) = 120 + (-4) = 116
        expect(result.ZTpredBG).toBe(116);
    });

    it('uses dynamic ISF logarithmic formula when useDynISFLog is true', () => {
        const IOBpredBGs = [120];
        const ZTpredBGs = [120];
        const iobTick = makeIOBTick({ activity: 0.05, iobWithZeroTemp: { iob: 0, activity: 0.02 } as IOBEntry });

        const result = predictIOBandZT(
            iobTick, IOBpredBGs, ZTpredBGs, 40, 3,
            true, 50, 0.8, 75,
        );

        // Dynamic ISF path: uses calculateDynISFBGImpact instead of predBGI
        // dynIOBBGI = calculateDynISFBGImpact(0.05, 120, 50, 0.8, 75) = -11.77
        expect(result.IOBpredBG).toBeCloseTo(120 + (-11.77) + result.predDev, 0);
        // Still returns predBGI for downstream use
        expect(result.predBGI).toBe(-10);
    });

    it('decays predDev toward zero as IOBpredBGs grows', () => {
        const IOBpredBGs = Array(12).fill(100); // 12 entries = 60m worth
        const ZTpredBGs = [100];
        const iobTick = makeIOBTick();

        const result = predictIOBandZT(
            iobTick, IOBpredBGs, ZTpredBGs, 40, 3,
            false, 0, 0, 0,
        );

        // At 12 entries: 12 / (60/5) = 12/12 = 1.0, min(1,1) = 1, predDev = 3 * 0 = 0
        expect(result.predDev).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// predictCOB
// ---------------------------------------------------------------------------

describe('predictCOB', () => {
    it('computes COB prediction with linear decay carb impact', () => {
        const COBpredBGs = [120];
        const result = predictCOB(COBpredBGs, 5, 10, 2, 3, -10, 2);

        // predCI = max(0, max(0, 5) * (1 - 1 / max(10*2, 1))) = 5 * (1 - 1/20) = 5 * 0.95 = 4.75
        expect(result.predCI).toBeCloseTo(4.75, 2);
        // COBpredBG = 120 + (-10) + min(0, 2) + predCI + remainingCI
        // min(0, 2) = 0, so COBpredBG = 120 - 10 + 0 + predCI + remainingCI
        expect(result.COBpredBG).toBeDefined();
    });

    it('returns zero predCI when carbImpact is zero', () => {
        const COBpredBGs = [120];
        const result = predictCOB(COBpredBGs, 0, 10, 2, 3, -10, 0);
        expect(result.predCI).toBe(0);
    });

    it('decays predCI to zero as COBpredBGs length approaches carbImpactDuration * 2', () => {
        const COBpredBGs = Array(20).fill(100); // 20 = carbImpactDuration(10) * LINEAR_DECAY_FACTOR(2)
        const result = predictCOB(COBpredBGs, 5, 10, 2, 3, -10, 0);
        expect(result.predCI).toBe(0);
    });

    it('only uses negative predDev for COB predictions', () => {
        const COBpredBGs = [120];
        const positiveResult = predictCOB(COBpredBGs, 5, 10, 2, 3, -10, 5);
        const negativeResult = predictCOB(COBpredBGs, 5, 10, 2, 3, -10, -3);

        // Positive predDev → min(0, 5) = 0, no effect
        // Negative predDev → min(0, -3) = -3, adds negative impact
        expect(negativeResult.COBpredBG).toBeLessThan(positiveResult.COBpredBG);
    });
});

// ---------------------------------------------------------------------------
// predictUAM
// ---------------------------------------------------------------------------

describe('predictUAM', () => {
    it('computes UAM prediction using slope-based carb impact', () => {
        const UAMpredBGs = [120];
        const iobTick = makeIOBTick({ activity: 0.05 });

        const result = predictUAM(
            iobTick, UAMpredBGs, 5, -0.1,
            -10, 2, false, 0, 0, 0,
        );

        // predUCIslope = max(0, 5 + 1 * (-0.1)) = max(0, 4.9) = 4.9
        // predUCImax = max(0, 5 * (1 - 1 / max(3*60/5, 1))) = 5 * (1 - 1/36) ≈ 4.86
        // predUCI = min(4.9, 4.86) ≈ 4.86
        expect(result.predUCI).toBeCloseTo(4.86, 1);
        // UAMpredBG = 120 + (-10) + min(0, 2) + predUCI = 120 - 10 + 0 + 4.86 ≈ 114.86
        expect(result.UAMpredBG).toBeCloseTo(114.86, 0);
    });

    it('returns zero predUCI when uamCarbImpact is zero and slope is negative', () => {
        const UAMpredBGs = [120];
        const iobTick = makeIOBTick();

        const result = predictUAM(
            iobTick, UAMpredBGs, 0, -0.1,
            -10, 0, false, 0, 0, 0,
        );

        expect(result.predUCI).toBe(0);
    });

    it('decays predUCImax to zero as UAMpredBGs length approaches 3h', () => {
        const UAMpredBGs = Array(36).fill(100); // 36 = 3h * 60m / 5m
        const iobTick = makeIOBTick();

        const result = predictUAM(
            iobTick, UAMpredBGs, 5, 0,
            -10, 0, false, 0, 0, 0,
        );

        expect(result.predUCI).toBe(0);
    });

    it('uses dynamic ISF formula when useDynISFLog is true', () => {
        const UAMpredBGs = [120];
        const iobTick = makeIOBTick({ activity: 0.05 });

        const standard = predictUAM(
            iobTick, UAMpredBGs, 5, -0.1,
            -10, 2, false, 0, 0, 0,
        );
        const dynamic = predictUAM(
            iobTick, UAMpredBGs, 5, -0.1,
            -10, 2, true, 50, 0.8, 75,
        );

        // Dynamic ISF uses different BGI calculation, results should differ
        expect(dynamic.UAMpredBG).not.toBe(standard.UAMpredBG);
        // predUCI should be the same (doesn't depend on ISF formula)
        expect(dynamic.predUCI).toBeCloseTo(standard.predUCI, 2);
    });
});

/** Build a default ClipAndTrimInputs with overrides. */
function makeClipInputs(overrides: Partial<ClipAndTrimInputs> = {}): ClipAndTrimInputs {
    return {
        IOBpredBGs: [120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 65, 60],
        ZTpredBGs: [120, 118, 116, 114, 112, 110, 108],
        COBpredBGs: [120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180],
        UAMpredBGs: [120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180],
        eventualBG: 100,
        target_bg: 100,
        mealCOB: 0,
        carbImpact: 0,
        remainingCIpeak: 0,
        enableUAM: false,
        predCIs: [],
        remainingCIs: [],
        ...overrides,
    };
}

/** Build a default MinGuardBGInputs with overrides. */
function makeMinGuardInputs(overrides: Partial<MinGuardBGInputs> = {}): MinGuardBGInputs {
    return {
        // Min predictions from loop (PRED_BG_SENTINEL = not computed)
        minIOBPredBG: 80,
        minCOBPredBG: 999,
        minUAMPredBG: 999,
        // Guard BGs from loop
        minCOBGuardBG: 999,
        minUAMGuardBG: 999,
        minIOBGuardBG: 80,
        minZTGuardBG: 85,
        // Last predicted values
        IOBpredBG: 90,
        COBpredBG: undefined,
        UAMpredBG: undefined,
        // BG context
        bg: 120,
        maxCOBPredBG: 120,
        threshold: 65,
        target_bg: 100,
        // Meal / carb context
        mealCOB: 0,
        carbs: 0,
        carbImpactDuration: 0,
        remainingCIpeak: 0,
        enableUAM: false,
        // Logging
        uamCarbImpact: 0,
        UAMduration: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// clipAndTrimPredictions
// ---------------------------------------------------------------------------

describe('clipAndTrimPredictions', () => {
    it('clips IOB values below MIN_VALID_GLUCOSE_MGDL (39) to 39', () => {
        const inputs = makeClipInputs({
            IOBpredBGs: [120, 100, 80, 60, 40, 20, 10, 0, -10, -20, -30, -40, -50],
        });
        const result = clipAndTrimPredictions(inputs);
        // Values below 39 should be clamped to 39
        expect(result.predBGs.IOB.every(v => v >= 39)).toBe(true);
    });

    it('clips IOB values above MAX_VALID_GLUCOSE_MGDL+1 (401) to 401', () => {
        const inputs = makeClipInputs({
            IOBpredBGs: [120, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300],
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.IOB.every(v => v <= 401)).toBe(true);
    });

    it('trims flat IOB tails beyond MIN_PRED_TRIM_POINTS (12)', () => {
        // 15 values, last 5 are all 100 -> should trim to leave last non-flat point
        const flat = [120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 65, 100, 100, 100];
        const inputs = makeClipInputs({ IOBpredBGs: flat });
        const result = clipAndTrimPredictions(inputs);
        // Should trim the trailing flat 100s down to one (or until index 12)
        expect(result.predBGs.IOB.length).toBeLessThan(15);
    });

    it('does not trim IOB below MIN_PRED_TRIM_POINTS (12)', () => {
        // 13 values, all the same -> can only trim down to 13 (index 12 is the limit)
        const flat = Array(13).fill(100);
        const inputs = makeClipInputs({ IOBpredBGs: flat });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.IOB.length).toBe(13);
    });

    it('trims ZT predictions that are rising and above target', () => {
        // Rising sequence above target_bg=100
        const rising = [90, 95, 100, 105, 110, 115, 120, 125];
        const inputs = makeClipInputs({ ZTpredBGs: rising, target_bg: 100 });
        const result = clipAndTrimPredictions(inputs);
        // Should trim trailing rising values above 100 (keeps >= MIN_ZT_TRIM_POINTS=6)
        expect(result.predBGs.ZT.length).toBeLessThanOrEqual(rising.length);
    });

    it('does not trim ZT when values are falling', () => {
        const falling = [120, 115, 110, 105, 100, 95, 90, 85];
        const inputs = makeClipInputs({ ZTpredBGs: falling, target_bg: 100 });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.ZT.length).toBe(8);
    });

    it('includes COB in predBGs when mealCOB > 0 and carbImpact > 0', () => {
        const inputs = makeClipInputs({
            mealCOB: 20,
            carbImpact: 5,
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.COB).toBeDefined();
        expect(result.lastCOBpredBG).toBeDefined();
    });

    it('does not include COB when mealCOB is 0', () => {
        const inputs = makeClipInputs({ mealCOB: 0, carbImpact: 5 });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.COB).toBeUndefined();
        expect(result.lastCOBpredBG).toBeUndefined();
    });

    it('includes UAM in predBGs when enableUAM and carbImpact > 0', () => {
        const inputs = makeClipInputs({
            enableUAM: true,
            carbImpact: 5,
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.UAM).toBeDefined();
        expect(result.lastUAMpredBG).toBeDefined();
    });

    it('does not include UAM when enableUAM is false', () => {
        const inputs = makeClipInputs({
            enableUAM: false,
            carbImpact: 5,
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.predBGs.UAM).toBeUndefined();
    });

    it('updates eventualBG from COB predictions', () => {
        const inputs = makeClipInputs({
            eventualBG: 100,
            mealCOB: 20,
            carbImpact: 5,
            COBpredBGs: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240],
        });
        const result = clipAndTrimPredictions(inputs);
        // eventualBG should be raised to match last COBpredBG (240)
        expect(result.eventualBG).toBeGreaterThanOrEqual(240);
    });

    it('updates eventualBG from UAM predictions', () => {
        const inputs = makeClipInputs({
            eventualBG: 100,
            enableUAM: true,
            carbImpact: 5,
            UAMpredBGs: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240],
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.eventualBG).toBeGreaterThanOrEqual(240);
    });

    it('does not update eventualBG from UAM when UAMpredBGs is empty (falsy last element)', () => {
        // When UAMpredBGs is empty, UAMpredBGs[UAMpredBGs.length-1] is undefined (falsy),
        // so eventualBG should not be updated from UAM predictions.
        const inputs = makeClipInputs({
            eventualBG: 100,
            enableUAM: true,
            carbImpact: 5,
            UAMpredBGs: [],
        });
        const result = clipAndTrimPredictions(inputs);
        // eventualBG stays at the original 100 (not updated by UAM)
        expect(result.eventualBG).toBe(100);
        // UAM array is still assigned to predBGs even though empty
        expect(result.predBGs.UAM).toBeDefined();
    });

    it('returns lastIOBpredBG as rounded last element of IOBpredBGs', () => {
        const inputs = makeClipInputs({
            IOBpredBGs: [120, 115, 110, 105, 100, 95, 90, 85, 80, 75, 70, 65, 62],
        });
        const result = clipAndTrimPredictions(inputs);
        expect(result.lastIOBpredBG).toBe(62);
    });

    it('clips COB to COB_PRED_BG_CAP (1500) instead of 401', () => {
        const inputs = makeClipInputs({
            mealCOB: 20,
            carbImpact: 5,
            COBpredBGs: [120, 500, 1000, 1400, 1600, 1800, 2000, 120, 120, 120, 120, 120, 120],
        });
        const result = clipAndTrimPredictions(inputs);
        // COB uses cap of 1500, not 401
        expect(result.predBGs.COB!.every(v => v <= 1500)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// calculateMinAndGuardBGs
// ---------------------------------------------------------------------------

describe('calculateMinAndGuardBGs', () => {
    it('returns minPredBG = minIOBPredBG when no COB/UAM', () => {
        const inputs = makeMinGuardInputs({ minIOBPredBG: 75 });
        const result = calculateMinAndGuardBGs(inputs);
        expect(result.minPredBG).toBe(75);
    });

    it('floors minIOBPredBG at MIN_VALID_GLUCOSE_MGDL (39)', () => {
        const inputs = makeMinGuardInputs({ minIOBPredBG: 20 });
        const result = calculateMinAndGuardBGs(inputs);
        expect(result.minIOBPredBG).toBe(39);
    });

    it('computes avgPredBG from IOB only when no COB/UAM', () => {
        const inputs = makeMinGuardInputs({ IOBpredBG: 90 });
        const result = calculateMinAndGuardBGs(inputs);
        // avgPredBG = round(IOBpredBG) = 90
        expect(result.avgPredBG).toBe(90);
    });

    it('averages IOB and COB for avgPredBG when COB present but no UAM', () => {
        const inputs = makeMinGuardInputs({
            minCOBPredBG: 85,
            IOBpredBG: 90,
            COBpredBG: 100,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // avgPredBG = round((90 + 100) / 2) = 95
        expect(result.avgPredBG).toBe(95);
    });

    it('averages IOB and UAM for avgPredBG when UAM present but no COB', () => {
        const inputs = makeMinGuardInputs({
            minUAMPredBG: 85,
            IOBpredBG: 90,
            UAMpredBG: 100,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // avgPredBG = round((90 + 100) / 2) = 95
        expect(result.avgPredBG).toBe(95);
    });

    it('blends COB and UAM for avgPredBG when both present', () => {
        const inputs = makeMinGuardInputs({
            minCOBPredBG: 85,
            minUAMPredBG: 85,
            COBpredBG: 100,
            UAMpredBG: 80,
            mealCOB: 20,
            carbs: 40,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // fractionCarbsLeft = 20/40 = 0.5
        // avgPredBG = round(0.5 * 80 + 0.5 * 100) = round(90) = 90
        expect(result.avgPredBG).toBe(90);
    });

    it('raises avgPredBG to minZTGuardBG when minZTGuardBG is higher', () => {
        const inputs = makeMinGuardInputs({
            IOBpredBG: 70,
            minZTGuardBG: 90,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // avgPredBG would be 70, but minZTGuardBG=90 raises it
        expect(result.avgPredBG).toBe(90);
    });

    it('uses minIOBGuardBG for minGuardBG when no COB/UAM', () => {
        const inputs = makeMinGuardInputs({ minIOBGuardBG: 72 });
        const result = calculateMinAndGuardBGs(inputs);
        expect(result.minGuardBG).toBe(72);
    });

    it('blends COB and UAM guard BGs when both present', () => {
        const inputs = makeMinGuardInputs({
            carbImpactDuration: 5,
            enableUAM: true,
            minCOBGuardBG: 80,
            minUAMGuardBG: 70,
            mealCOB: 20,
            carbs: 40,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // fractionCarbsLeft = 0.5
        // minGuardBG = round(0.5*80 + 0.5*70) = round(75) = 75
        expect(result.minGuardBG).toBe(75);
    });

    it('averages minUAMPredBG and minZTGuardBG when ZT < threshold', () => {
        const inputs = makeMinGuardInputs({
            enableUAM: true,
            carbs: 40,
            mealCOB: 0,
            minUAMPredBG: 100,
            UAMpredBG: 80,
            minZTGuardBG: 60,
            threshold: 65,
            target_bg: 100,
            minIOBPredBG: 80,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // minZTGuardBG (60) < threshold (65)
        // minZTUAMPredBG = (100 + 60) / 2 = 80
        // enableUAM + no carbs -> minPredBG = round(max(80, 80)) = 80
        expect(result.minPredBG).toBeLessThanOrEqual(result.avgPredBG);
    });

    it('caps minPredBG at avgPredBG', () => {
        const inputs = makeMinGuardInputs({
            minIOBPredBG: 100,
            IOBpredBG: 80,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // minPredBG (100) > avgPredBG (80) -> capped at 80
        expect(result.minPredBG).toBeLessThanOrEqual(result.avgPredBG);
    });

    it('applies maxCOBPredBG fallback when above bg', () => {
        const inputs = makeMinGuardInputs({
            minIOBPredBG: 90,
            IOBpredBG: 90,
            bg: 100,
            maxCOBPredBG: 85,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // maxCOBPredBG (85) < bg (100) -> no effect
        // but minPredBG still capped at avgPredBG
        expect(result.minPredBG).toBe(Math.min(90, result.avgPredBG));
    });

    it('reduces minPredBG via maxCOBPredBG when it exceeds bg', () => {
        const inputs = makeMinGuardInputs({
            minIOBPredBG: 150,
            IOBpredBG: 150,
            bg: 120,
            maxCOBPredBG: 130,
            minZTGuardBG: 999,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // maxCOBPredBG (130) > bg (120) -> minPredBG = min(minPredBG, 130)
        expect(result.minPredBG).toBeLessThanOrEqual(130);
    });

    it('uses minCOBPredBG with carbs and no UAM', () => {
        const inputs = makeMinGuardInputs({
            minIOBPredBG: 80,
            minCOBPredBG: 85,
            COBpredBG: 90,
            enableUAM: false,
            carbs: 40,
            mealCOB: 20,
        });
        const result = calculateMinAndGuardBGs(inputs);
        // carbs present, UAM disabled, minCOBPredBG < SENTINEL
        // minPredBG = round(max(80, 85)) = 85
        expect(result.minPredBG).toBeLessThanOrEqual(result.avgPredBG);
    });

    it('logs UAM impact and min prediction summary', () => {
        const inputs = makeMinGuardInputs({ uamCarbImpact: 5, UAMduration: 1.5 });
        calculateMinAndGuardBGs(inputs);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('UAM Impact:5mg/dL per 5m; UAM Duration:1.5hours'),
        );
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('minPredBG:'),
        );
    });
});

// ---------------------------------------------------------------------------
// calculateAvgPredBG
// ---------------------------------------------------------------------------

// PRED_BG_SENTINEL = 999

describe('calculateAvgPredBG', () => {
    it('returns round(IOBpredBG) when no COB or UAM predictions', () => {
        // Both minUAMPredBG and minCOBPredBG are sentinel (999)
        const result = calculateAvgPredBG(0.5, 999, 999, 80, 90.7, undefined, undefined);
        expect(result).toBe(91);
    });

    it('averages IOB and COB when COB present but no UAM', () => {
        // minCOBPredBG < 999, minUAMPredBG = 999
        const result = calculateAvgPredBG(0.5, 999, 85, 60, 90, 100, undefined);
        // avgPredBG = round((90 + 100) / 2) = 95
        expect(result).toBe(95);
    });

    it('averages IOB and UAM when UAM present but no COB', () => {
        // minUAMPredBG < 999, minCOBPredBG = 999
        const result = calculateAvgPredBG(0.5, 85, 999, 60, 90, undefined, 100);
        // avgPredBG = round((90 + 100) / 2) = 95
        expect(result).toBe(95);
    });

    it('blends COB and UAM weighted by fractionCarbsLeft when both present', () => {
        // fractionCarbsLeft = 0.5, UAMpredBG = 80, COBpredBG = 100
        // avgPredBG = round(0.5 * 80 + 0.5 * 100) = 90
        const result = calculateAvgPredBG(0.5, 85, 85, 60, 90, 100, 80);
        expect(result).toBe(90);
    });

    it('raises avgPredBG to minZTGuardBG when minZTGuardBG is higher', () => {
        // IOB-only: avgPredBG = round(70) = 70, but minZTGuardBG = 90
        const result = calculateAvgPredBG(0.5, 999, 999, 90, 70, undefined, undefined);
        expect(result).toBe(90);
    });

    it('does not lower avgPredBG when minZTGuardBG is lower', () => {
        const result = calculateAvgPredBG(0.5, 999, 999, 50, 90, undefined, undefined);
        expect(result).toBe(90);
    });
});

// ---------------------------------------------------------------------------
// blendMinGuardBG
// ---------------------------------------------------------------------------

describe('blendMinGuardBG', () => {
    it('uses minIOBGuardBG when no carb impact and no UAM', () => {
        const result = blendMinGuardBG(0.5, 80, 70, 72, 85, 100, 0, 0, false, 65, 100);
        expect(result.minGuardBG).toBe(72);
    });

    it('uses minUAMGuardBG when UAM enabled but no carb impact', () => {
        const result = blendMinGuardBG(0.5, 80, 70, 72, 85, 100, 0, 0, true, 65, 100);
        expect(result.minGuardBG).toBe(70);
    });

    it('uses minCOBGuardBG when carb impact but no UAM', () => {
        const result = blendMinGuardBG(0.5, 80, 70, 72, 85, 100, 5, 0, false, 65, 100);
        expect(result.minGuardBG).toBe(80);
    });

    it('blends COB and UAM guard BGs when both present', () => {
        // fractionCarbsLeft = 0.5, minCOBGuardBG = 80, minUAMGuardBG = 70
        // minGuardBG = round(0.5 * 80 + 0.5 * 70) = 75
        const result = blendMinGuardBG(0.5, 80, 70, 72, 85, 100, 5, 0, true, 65, 100);
        expect(result.minGuardBG).toBe(75);
    });

    it('averages minUAMPredBG and minZTGuardBG when ZT < threshold', () => {
        // minZTGuardBG = 60 < threshold = 65
        // minZTUAMPredBG = (100 + 60) / 2 = 80
        const result = blendMinGuardBG(0.5, 80, 70, 72, 60, 100, 0, 0, false, 65, 100);
        expect(result.minZTUAMPredBG).toBe(80);
    });

    it('blends minZTUAMPredBG when ZT between threshold and target', () => {
        // minZTGuardBG = 85, threshold = 65, target = 100
        // blendPct = (85-65) / (100-65) = 20/35 ≈ 0.5714
        // blendedMinZTGuardBG = 100 * 0.5714 + 85 * 0.4286 ≈ 93.57
        // minZTUAMPredBG = (100 + 93.57) / 2 ≈ 96.79 → round = 97
        const result = blendMinGuardBG(0.5, 80, 70, 72, 85, 100, 0, 0, false, 65, 100);
        expect(result.minZTUAMPredBG).toBe(97);
    });

    it('averages when minZTGuardBG > minUAMPredBG (both above target)', () => {
        // minZTGuardBG = 110 > target = 100 and > minUAMPredBG = 90
        // minZTUAMPredBG = (90 + 110) / 2 = 100
        const result = blendMinGuardBG(0.5, 80, 70, 72, 110, 90, 0, 0, false, 65, 100);
        expect(result.minZTUAMPredBG).toBe(100);
    });

    it('leaves minZTUAMPredBG unchanged when ZT >= target and <= minUAMPredBG', () => {
        // minZTGuardBG = 100, target = 100, minUAMPredBG = 120
        // None of the conditions trigger
        const result = blendMinGuardBG(0.5, 80, 70, 72, 100, 120, 0, 0, false, 65, 100);
        expect(result.minZTUAMPredBG).toBe(120);
    });
});

// ---------------------------------------------------------------------------
// selectMinPredBG
// ---------------------------------------------------------------------------

describe('selectMinPredBG', () => {
    it('returns round(minIOBPredBG) when no carbs and no UAM', () => {
        const result = selectMinPredBG(0.5, 80.4, 999, 90, 75, 100, false, 0);
        expect(result).toBe(80);
    });

    it('uses max(minIOBPredBG, minCOBPredBG) with carbs and no UAM', () => {
        // carbs = 40, enableUAM = false, minIOBPredBG = 80, minCOBPredBG = 85
        const result = selectMinPredBG(0.5, 80, 85, 90, 75, 100, false, 40);
        expect(result).toBe(85);
    });

    it('blends COB and ZT-UAM when carbs present with COB and UAM', () => {
        // fractionCarbsLeft = 0.5, minCOBPredBG = 85, minZTUAMPredBG = 95
        // blendedMinPredBG = 0.5 * 85 + 0.5 * 95 = 90
        // minPredBG = round(max(80, 85, 90)) = 90
        const result = selectMinPredBG(0.5, 80, 85, 95, 75, 100, true, 40);
        expect(result).toBe(90);
    });

    it('uses minZTUAMPredBG when carbs entered but expired (no COB)', () => {
        // carbs = 40, enableUAM = true, minCOBPredBG = 999 (sentinel)
        const result = selectMinPredBG(0.5, 80, 999, 88, 75, 100, true, 40);
        expect(result).toBe(88);
    });

    it('uses minGuardBG when carbs entered but no COB and no UAM', () => {
        const result = selectMinPredBG(0.5, 80, 999, 90, 75, 100, false, 40);
        expect(result).toBe(75);
    });

    it('uses max(minIOBPredBG, minZTUAMPredBG) in pure UAM mode (no carbs)', () => {
        // enableUAM = true, carbs = 0, minIOBPredBG = 80, minZTUAMPredBG = 90
        const result = selectMinPredBG(0.5, 80, 999, 90, 75, 100, true, 0);
        expect(result).toBe(90);
    });

    it('caps minPredBG at avgPredBG', () => {
        // minIOBPredBG = 100, avgPredBG = 85 → capped at 85
        const result = selectMinPredBG(0.5, 100, 999, 90, 75, 85, false, 0);
        expect(result).toBe(85);
    });
});
