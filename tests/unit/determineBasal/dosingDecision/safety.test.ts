import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    enforceSMBSafetyGuards,
    checkPredictiveLGS,
    checkTopOfHourCancel,
} from '../../../../src/determineBasal/dosingDecision/safety';

import type { DosingContext } from '../../../../src/determineBasal/dosingDecision/types';

import {
    makeDosingContext,
    makeIobData,
    makeProfile,
    makeGlucoseStatus,
    makeTempBasalFunctions,
} from '../../helpers';

// ---------------------------------------------------------------------------
// Constants from the source (for reference in assertions)
// ---------------------------------------------------------------------------

// DEFAULT_MAX_DELTA_BG_THRESHOLD = 0.2
// MAX_DELTA_BG_THRESHOLD_CAP = 0.4
// BOLUS_ERR_GUARD_BELOW_THRESHOLD = 1
// BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD = 2
// TOP_OF_HOUR_WINDOW_MINUTES = 55
// MINUTES_PER_HOUR = 60
// TEMP_BASAL_DURATION_MINUTES = 30
// MAX_TEMP_BASAL_DURATION_MINUTES = 120
// IOB_NEG_CHECK_MINUTES = 20

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Factory — thin wrapper over shared makeDosingContext with file-specific defaults.
// The safety tests use Partial<DosingContext> overrides at the top level, so we
// build the base context from the shared factory and spread overrides on top.
// ---------------------------------------------------------------------------

const mockTempBasalFunctions = makeTempBasalFunctions();

function makeTestContext(overrides: Partial<DosingContext> = {}): DosingContext {
    const base = makeDosingContext({
        inputs: {
            iobData: makeIobData({
                iob: 1.5,
                activity: 0.02,
                basaliob: 0.5,
                bolusiob: 1.0,
                netbasalinsulin: 0.3,
                bolusinsulin: 2.0,
            }),
            profile: makeProfile({
                min_bg: 100,
                max_bg: 100,
            }),
            glucoseStatus: makeGlucoseStatus({
                glucose: 120,
                delta: 2,
                short_avgdelta: 2,
                long_avgdelta: 1,
            }),
            tempBasalFunctions: mockTempBasalFunctions,
            bg: 120,
            eventualBG: 100,
            naiveEventualBG: 100,
            threshold: 80,
            targetBG: 100,
            minBG: 100,
            maxBG: 100,
            expectedDelta: -1,
            minDelta: 1,
            maxDelta: 3,
            tick: '+2',
            bgImpact: -2,
            deviation: 5,
            carbSensFactor: 1,
            minPredBG: 90,
            minGuardBG: 90,
            lastIOBpredBG: 95,
            lastCOBpredBG: 100,
            lastUAMpredBG: 100,
            minIOBPredBG: 85,
            IOBpredBGs: [120, 110, 100, 90],
            COBpredBGs: [120, 115, 110, 105],
            microBolusAllowed: true,
            enableSMB: true,
        },
        result: { reason: '' },
        enableSMB: true,
        insulinReq: 0,
        rate: 0,
    });

    return {
        ...base,
        ...overrides,
    } as unknown as DosingContext;
}

// ---------------------------------------------------------------------------
// enforceSMBSafetyGuards
// ---------------------------------------------------------------------------

describe('enforceSMBSafetyGuards', () => {
    it('disables enableSMB when minGuardBG < threshold', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 70;
        (ctx.inputs as { threshold: number }).threshold = 80;
        ctx.enableSMB = true;

        enforceSMBSafetyGuards(ctx);

        expect(ctx.enableSMB).toBe(false);
    });

    it('sets result.manualBolusErrorString = 1 when disabling for guard BG', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 70;
        (ctx.inputs as { threshold: number }).threshold = 80;
        (ctx.inputs as { eventualBG: number }).eventualBG = 130;
        ctx.result.eventualBG = 130;
        ctx.result.target_bg = 100;
        ctx.enableSMB = true;

        enforceSMBSafetyGuards(ctx);

        expect(ctx.result.manualBolusErrorString).toBe(1);
    });

    it('does not disable when minGuardBG >= threshold', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 85;
        (ctx.inputs as { threshold: number }).threshold = 80;
        ctx.enableSMB = true;

        enforceSMBSafetyGuards(ctx);

        expect(ctx.enableSMB).toBe(true);
    });

    it('disables enableSMB when maxDelta > maxDelta_bg_threshold * bg (default threshold 0.2)', () => {
        const ctx = makeTestContext();
        // bg=100, default threshold=0.2, so limit=20; set maxDelta=25 to exceed
        (ctx.inputs as { bg: number }).bg = 100;
        (ctx.inputs as { maxDelta: number }).maxDelta = 25;
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 90;
        (ctx.inputs as { threshold: number }).threshold = 80;
        // Ensure profile.maxDelta_bg_threshold is undefined to use default
        (ctx.inputs.profile as { maxDelta_bg_threshold: undefined }).maxDelta_bg_threshold = undefined;
        ctx.enableSMB = true;

        enforceSMBSafetyGuards(ctx);

        expect(ctx.enableSMB).toBe(false);
        expect(ctx.result.reason).toContain('SMB disabled');
    });

    it('uses profile.maxDelta_bg_threshold when defined, capped at 0.4', () => {
        const ctx = makeTestContext();
        // Set profile.maxDelta_bg_threshold = 0.6 -- should be capped to 0.4
        // bg=100, so limit = 0.4 * 100 = 40; maxDelta=45 exceeds it
        (ctx.inputs.profile as { maxDelta_bg_threshold: number }).maxDelta_bg_threshold = 0.6;
        (ctx.inputs as { bg: number }).bg = 100;
        (ctx.inputs as { maxDelta: number }).maxDelta = 45;
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 90;
        (ctx.inputs as { threshold: number }).threshold = 80;
        ctx.enableSMB = true;

        enforceSMBSafetyGuards(ctx);

        expect(ctx.enableSMB).toBe(false);
        // Verify the cap applied: reason should show "40%" not "60%"
        expect(ctx.result.reason).toContain('40%');
    });

    it('always returns { done: false }', () => {
        const ctx = makeTestContext();

        const outcome = enforceSMBSafetyGuards(ctx);

        expect(outcome).toEqual({ done: false });
    });
});

// ---------------------------------------------------------------------------
// checkPredictiveLGS
// ---------------------------------------------------------------------------

describe('checkPredictiveLGS', () => {
    it('returns { done: false } when bg >= threshold and minGuardBG >= threshold', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { bg: number }).bg = 120;
        (ctx.inputs as { threshold: number }).threshold = 80;
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 90;

        const outcome = checkPredictiveLGS(ctx);

        expect(outcome).toEqual({ done: false });
    });

    it('returns { done: true } with zero temp when bg < threshold (LGS mode)', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { bg: number }).bg = 70;
        (ctx.inputs as { threshold: number }).threshold = 80;
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 65;
        (ctx.inputs as { targetBG: number }).targetBG = 100;
        (ctx.inputs as { eventualBG: number }).eventualBG = 90;
        (ctx.inputs as { adjustedSens: number }).adjustedSens = 50;
        // IOB positive so the "super negative" skip branch is not triggered
        (ctx.inputs.iobData as { iob: number }).iob = 1.5;

        const outcome = checkPredictiveLGS(ctx);

        expect(outcome.done).toBe(true);
        // setTempBasal should have been called with rate=0
        expect(mockTempBasalFunctions.setTempBasal).toHaveBeenCalledWith(
            0,
            expect.any(Number),
            ctx.inputs.profile,
            ctx.result,
            ctx.inputs.currenttemp,
        );
    });

    it('skips LGS when IOB is super negative and BG is rising faster than predicted', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { bg: number }).bg = 70;
        (ctx.inputs as { threshold: number }).threshold = 80;
        // IOB_NEG_CHECK_MINUTES = 20, current_basal = 1.0, overrideFactor = 1.0
        // Negative IOB threshold = -1.0 * 1.0 * 20 / 60 = -0.333
        // Set iob below that
        (ctx.inputs.iobData as { iob: number }).iob = -0.5;
        (ctx.inputs.profile as { current_basal: number }).current_basal = 1.0;
        (ctx.inputs as { overrideFactor: number }).overrideFactor = 1.0;
        // minDelta > 0 and minDelta > expectedDelta
        (ctx.inputs as { minDelta: number }).minDelta = 3;
        (ctx.inputs as { expectedDelta: number }).expectedDelta = 1;

        const outcome = checkPredictiveLGS(ctx);

        // Should skip LGS and return { done: false }
        expect(outcome).toEqual({ done: false });
        // Reason should mention IOB
        expect(ctx.result.reason).toContain('IOB');
    });

    it('sets result.manualBolusErrorString = 2 in LGS mode', () => {
        const ctx = makeTestContext();
        (ctx.inputs as { bg: number }).bg = 120;
        (ctx.inputs as { threshold: number }).threshold = 80;
        // minGuardBG below threshold triggers LGS
        (ctx.inputs as { minGuardBG: number }).minGuardBG = 70;
        (ctx.inputs as { targetBG: number }).targetBG = 100;
        (ctx.inputs as { eventualBG: number }).eventualBG = 90;
        (ctx.inputs as { adjustedSens: number }).adjustedSens = 50;
        (ctx.inputs.iobData as { iob: number }).iob = 1.5;

        checkPredictiveLGS(ctx);

        expect(ctx.result.manualBolusErrorString).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// checkTopOfHourCancel
// ---------------------------------------------------------------------------

describe('checkTopOfHourCancel', () => {
    it('returns { done: false } when skip_neutral_temps is false', () => {
        const ctx = makeTestContext();
        (ctx.inputs.profile as { skip_neutral_temps: boolean }).skip_neutral_temps = false;

        const outcome = checkTopOfHourCancel(ctx);

        expect(outcome).toEqual({ done: false });
    });

    it('returns { done: true } with zero temp when at top of hour and SMB disabled', () => {
        const ctx = makeTestContext();
        (ctx.inputs.profile as { skip_neutral_temps: boolean }).skip_neutral_temps = true;
        ctx.enableSMB = false;
        // deliverAt at 55 minutes past the hour (>= TOP_OF_HOUR_WINDOW_MINUTES = 55)
        ctx.result.deliverAt = new Date('2025-01-15T12:55:00Z');

        const outcome = checkTopOfHourCancel(ctx);

        expect(outcome.done).toBe(true);
        expect(mockTempBasalFunctions.setTempBasal).toHaveBeenCalledWith(
            0,
            0,
            ctx.inputs.profile,
            ctx.result,
            ctx.inputs.currenttemp,
        );
        expect(ctx.result.reason).toContain('Canceling temp');
    });

    it('does not cancel when SMB is enabled (returns { done: false })', () => {
        const ctx = makeTestContext();
        (ctx.inputs.profile as { skip_neutral_temps: boolean }).skip_neutral_temps = true;
        ctx.enableSMB = true;
        // deliverAt at 55 minutes past the hour
        ctx.result.deliverAt = new Date('2025-01-15T12:55:00Z');

        const outcome = checkTopOfHourCancel(ctx);

        expect(outcome).toEqual({ done: false });
    });
});
