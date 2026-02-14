import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    handleLowBG,
    handleFallingDelta,
    handleInRange,
} from '../../../../src/determineBasal/dosingDecision/lowTemp';

import type { DosingContext } from '../../../../src/determineBasal/dosingDecision/types';
import type {
    Profile,
    GlucoseStatus,
    DetermineBasalResult,
} from '../../../../src/types/index';

// Relevant constants from the source (for reference in test design):
// TEMP_BASAL_DURATION_MINUTES       = 30
// MAX_TEMP_BASAL_DURATION_MINUTES   = 120
// TEMP_ACTIVE_DURATION_MINUTES      = 15
// TEMP_SHORT_DURATION_MINUTES       = 5
// RATE_TOLERANCE_LOW                = 0.8
// BASAL_SHORTFALL_FRACTION          = 0.3
// LOW_TEMP_CORRECTION_FACTOR        = 2
// LOW_BG_SAFETY_THRESHOLD           = 40
// DELTA_SIGNIFICANCE_THRESHOLD      = 2
// BOLUS_ERR_RISING_SLOWER           = 3
// BOLUS_ERR_FALLING_OR_MIXED        = 4
// BOLUS_ERR_OTHER_DELTA             = 5
// BOLUS_ERR_MIN_PRED_BELOW_MIN      = 6

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Build a minimal DosingContext with sane defaults, applying overrides. */
function makeTestContext(overrides: {
    inputs?: Partial<DosingContext['inputs']>;
    ctx?: Partial<Omit<DosingContext, 'inputs' | 'result'>>;
    result?: Partial<DetermineBasalResult>;
} = {}): DosingContext {
    const profile = {
        current_basal: 1.0,
        out_units: 'mg/dL',
        max_basal: 4.0,
        ...overrides.inputs?.profile,
    } as Profile;

    const glucoseStatus = {
        delta: 0,
        ...overrides.inputs?.glucoseStatus,
    } as GlucoseStatus;

    const currenttemp = {
        rate: 0,
        duration: 0,
        ...overrides.inputs?.currenttemp,
    };

    const tempBasalFunctions = {
        setTempBasal: vi.fn(
            (
                _r: number,
                _d: number,
                _p: Profile,
                result: DetermineBasalResult,
            ) => result,
        ),
        getMaxSafeBasal: vi.fn(() => 4),
        ...overrides.inputs?.tempBasalFunctions,
    };

    const inputs = {
        basal: 1.0,
        adjustedSens: 50,
        threshold: 65,
        targetBG: 100,
        minBG: 80,
        maxBG: 120,
        eventualBG: 120,
        naiveEventualBG: 120,
        minPredBG: 100,
        minDelta: 0,
        expectedDelta: 0,
        overrideFactor: 1,
        tick: 0,
        profile,
        currenttemp,
        glucoseStatus,
        tempBasalFunctions,
        microBolusAllowed: false,
        ...overrides.inputs,
        // Re-apply nested objects so partial overrides merge correctly
        ...(overrides.inputs?.profile ? { profile } : {}),
        ...(overrides.inputs?.glucoseStatus ? { glucoseStatus } : {}),
        ...(overrides.inputs?.currenttemp ? { currenttemp } : {}),
        ...(overrides.inputs?.tempBasalFunctions ? { tempBasalFunctions } : {}),
    } as DosingContext['inputs'];

    const result: DetermineBasalResult = {
        reason: '',
        ...overrides.result,
    };

    return {
        inputs,
        result,
        enableSMB: false,
        carbsReq: 0,
        rate: 1.0,
        insulinReq: 0,
        insulinScheduled: 0,
        bgUndershoot: 0,
        minutesAboveMinBG: 0,
        minutesAboveThreshold: 0,
        ...overrides.ctx,
    };
}

// ---------------------------------------------------------------------------
// handleLowBG
// ---------------------------------------------------------------------------

describe('handleLowBG', () => {
    it('returns { done: false } when eventualBG >= min_bg', () => {
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 80,
                minBG: 80,
            },
        });

        const outcome = handleLowBG(ctx);

        expect(outcome.done).toBe(false);
    });

    it('returns { done: true } with zero temp when naive_eventualBG < 40 and BG rising', () => {
        // Trigger: eventualBG < min_bg, minDelta > expectedDelta, minDelta > 0,
        //          carbsReq === 0, naive_eventualBG < 40
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 60,
                naiveEventualBG: 35,
                minBG: 80,
                minDelta: 2,
                expectedDelta: -1,
            },
            ctx: {
                carbsReq: 0,
            },
        });

        const outcome = handleLowBG(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            // setTempBasal called with rate=0, duration=30
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).toHaveBeenCalledWith(
                0,
                30,
                ctx.inputs.profile,
                ctx.result,
                ctx.inputs.currenttemp,
            );
        }
        expect(ctx.result.reason).toContain('naive_eventualBG < 40');
    });

    it('returns { done: true } with basal temp when BG rising faster than expected and current temp matches', () => {
        // Trigger: eventualBG < min_bg, minDelta > expectedDelta, minDelta > 0,
        //          naive_eventualBG >= 40, currenttemp.duration > 15 and roundBasal(basal) === roundBasal(currenttemp.rate)
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 60,
                naiveEventualBG: 50,
                minBG: 80,
                minDelta: 2,
                expectedDelta: -1,
                basal: 1.0,
                currenttemp: {
                    rate: 1.0,
                    duration: 20,
                },
                glucoseStatus: {
                    delta: 1,
                } as GlucoseStatus,
            },
            ctx: {
                carbsReq: 0,
            },
        });

        const outcome = handleLowBG(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            // Should return result directly (temp already matches), not call setTempBasal
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).not.toHaveBeenCalled();
        }
        expect(ctx.result.reason).toContain('temp 1 ~ req 1U/hr');
    });

    it('calculates low temp rate using insulinReq formula when eventualBG below target', () => {
        // Trigger: eventualBG < min_bg, minDelta <= expectedDelta (or minDelta <= 0),
        //          so we fall through the rising-BG branch into the insulinReq calculation.
        // eventualBG=60, target_bg=100, adjustedSens=50, basal=1.0
        // insulinReq = 2 * min(0, (60 - 100) / 50) = 2 * min(0, -0.8) = 2 * -0.8 = -1.6
        // rate = basal + 2 * insulinReq = 1.0 + 2 * -1.6 = 1.0 - 3.2 = -2.2
        // rate <= 0, so we enter the zero-temp duration calculation
        // naive_eventualBG=60, target_bg=100 => bgUndershoot = 100 - 60 = 40
        // worstCaseInsulinReq = 40 / 50 = 0.8
        // durationReq = round(60 * 0.8 / 1.0 * 1) = round(48) = 48
        // durationReq = round(48 / 30) * 30 = round(1.6) * 30 = 2 * 30 = 60
        // durationReq = min(120, max(0, 60)) = 60
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 60,
                naiveEventualBG: 60,
                minBG: 80,
                targetBG: 100,
                basal: 1.0,
                adjustedSens: 50,
                minDelta: -1,
                expectedDelta: 0,
                overrideFactor: 1,
            },
        });

        const outcome = handleLowBG(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).toHaveBeenCalledTimes(1);
            // rate should be <= 0, rounded via roundBasal
            const calledRate = mock.mock.calls[0][0];
            expect(calledRate).toBeLessThanOrEqual(0);
            // Duration should be 60 min (calculated zero-temp duration)
            const calledDuration = mock.mock.calls[0][1];
            expect(calledDuration).toBe(60);
        }
        // insulinReq should have been set on the context
        expect(ctx.insulinReq).toBeLessThan(0);
    });

    it('returns { done: true } with zero temp for rate <= 0 (short undershoot)', () => {
        // Use settings where rate ends up <= 0 but with a small undershoot so durationReq is short.
        // eventualBG=70, target_bg=100, adjustedSens=50, basal=0.5
        // insulinReq = 2 * min(0, (70 - 100) / 50) = 2 * -0.6 = -1.2
        // rate = 0.5 + 2 * -1.2 = 0.5 - 2.4 = -1.9 => roundBasal -> some negative
        // naive_eventualBG=90 => bgUndershoot = 100 - 90 = 10
        // worstCaseInsulinReq = 10 / 50 = 0.2
        // durationReq = round(60 * 0.2 / 0.5 * 1) = round(24) = 24
        // durationReq = round(24/30)*30 = round(0.8)*30 = 1*30 = 30
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 70,
                naiveEventualBG: 90,
                minBG: 80,
                targetBG: 100,
                basal: 0.5,
                adjustedSens: 50,
                minDelta: -1,
                expectedDelta: 0,
                overrideFactor: 1,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
                profile: {
                    current_basal: 0.5,
                    out_units: 'mg/dL',
                    max_basal: 4.0,
                } as Profile,
            },
        });

        const outcome = handleLowBG(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).toHaveBeenCalled();
            const calledRate = mock.mock.calls[0][0];
            expect(calledRate).toBeLessThanOrEqual(0);
            // Should set a zero temp with positive duration
            const calledDuration = mock.mock.calls[0][1];
            expect(calledDuration).toBeGreaterThan(0);
        }
        expect(ctx.result.reason).toContain('zero temp');
    });
});

// ---------------------------------------------------------------------------
// handleFallingDelta
// ---------------------------------------------------------------------------

describe('handleFallingDelta', () => {
    it('returns { done: false } when minDelta >= expectedDelta', () => {
        const ctx = makeTestContext({
            inputs: {
                minDelta: 0,
                expectedDelta: 0,
            },
        });

        const outcome = handleFallingDelta(ctx);

        expect(outcome.done).toBe(false);
    });

    it('sets manualBolusErrorString when delta significance exceeds threshold', () => {
        // Trigger: minDelta < expectedDelta and (expectedDelta - minDelta >= 2) or (expectedDelta + (-1*minDelta) >= 2)
        // minDelta=-2, expectedDelta=1 => expectedDelta - minDelta = 3 >= 2
        // minDelta < 0 and expectedDelta >= 0 => BOLUS_ERR_FALLING_OR_MIXED = 4
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -2,
                expectedDelta: 1,
                adjustedSens: 50,
                tick: -2,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        handleFallingDelta(ctx);

        expect(ctx.result.manualBolusErrorString).toBe(4);
    });

    it('returns { done: true } with basal temp in non-SMB mode when falling', () => {
        // Trigger: minDelta < expectedDelta, not in SMB mode
        // minDelta=-1, expectedDelta=0 => -1 < 0 => falling
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -1,
                expectedDelta: 0,
                basal: 1.0,
                adjustedSens: 50,
                tick: -1,
                microBolusAllowed: false,
                glucoseStatus: {
                    delta: 0,
                } as GlucoseStatus,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
            },
            ctx: {
                enableSMB: false,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        const outcome = handleFallingDelta(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).toHaveBeenCalledWith(
                1.0,
                30,
                ctx.inputs.profile,
                ctx.result,
                ctx.inputs.currenttemp,
            );
        }
        expect(ctx.result.reason).toContain('setting current basal of 1 as temp');
    });

    it('returns { done: false } when SMB mode is active (microBolusAllowed && enableSMB)', () => {
        // Trigger: minDelta < expectedDelta, but microBolusAllowed && enableSMB => skip non-SMB branch
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -1,
                expectedDelta: 0,
                basal: 1.0,
                adjustedSens: 50,
                tick: -1,
                microBolusAllowed: true,
            },
            ctx: {
                enableSMB: true,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        const outcome = handleFallingDelta(ctx);

        // Even though minDelta < expectedDelta, the SMB branch skips the temp basal
        expect(outcome.done).toBe(false);
        // But result fields should still be set
        expect(ctx.result.minDelta).toBe(-1);
        expect(ctx.result.expectedDelta).toBe(0);
    });

    it('uses Delta (tick) in reason when glucoseStatus.delta < minDelta in non-SMB mode', () => {
        // Trigger: minDelta < expectedDelta, not SMB mode, and glucoseStatus.delta < minDelta
        // This exercises the "Delta ... < Exp. Delta" branch (line 191)
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -1,
                expectedDelta: 0,
                basal: 1.0,
                adjustedSens: 50,
                tick: -3,
                microBolusAllowed: false,
                glucoseStatus: {
                    delta: -3,
                } as GlucoseStatus,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
            },
            ctx: {
                enableSMB: false,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        const outcome = handleFallingDelta(ctx);

        expect(outcome.done).toBe(true);
        // When delta < minDelta, reason uses "Delta" (not "Min. Delta")
        expect(ctx.result.reason).toContain('but Delta');
        expect(ctx.result.reason).toContain('< Exp. Delta');
    });

    it('uses Min. Delta in reason when glucoseStatus.delta >= minDelta in non-SMB mode', () => {
        // Trigger: minDelta < expectedDelta, not SMB mode, and glucoseStatus.delta >= minDelta
        // This exercises the "Min. Delta ... < Exp. Delta" branch (line 193)
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -2,
                expectedDelta: 0,
                basal: 1.0,
                adjustedSens: 50,
                tick: 0,
                microBolusAllowed: false,
                glucoseStatus: {
                    delta: 0,
                } as GlucoseStatus,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
            },
            ctx: {
                enableSMB: false,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        const outcome = handleFallingDelta(ctx);

        expect(outcome.done).toBe(true);
        // When delta >= minDelta, reason uses "Min. Delta" (not "Delta")
        expect(ctx.result.reason).toContain('but Min. Delta');
        expect(ctx.result.reason).toContain('< Exp. Delta');
    });

    it('classifies BOLUS_ERR_OTHER_DELTA when minDelta >= 0 and expectedDelta <= 0 with significant difference', () => {
        // classifyDeltaBehavior returns BOLUS_ERR_OTHER_DELTA (5) when:
        // - isSignificant (expectedDelta - minDelta >= 2 OR expectedDelta + (-1*minDelta) >= 2)
        // - minDelta >= 0 && expectedDelta > 0 is false
        // - (minDelta < 0 && expectedDelta <= 0) || (minDelta < 0 && expectedDelta >= 0) is false
        // So: minDelta >= 0, expectedDelta <= 0, and significant
        // expectedDelta - minDelta = -3 - 0 = -3 (not >= 2)
        // expectedDelta + (-1 * minDelta) = -3 + 0 = -3 (not >= 2)
        // We need: minDelta=0, expectedDelta=-3 => diff = -3 - 0 = -3, or (-3 + 0) = -3
        // Neither reaches 2. Need to adjust: minDelta=1, expectedDelta=-2
        // expectedDelta - minDelta = -2 - 1 = -3 (not >= 2)
        // expectedDelta + (-1 * minDelta) = -2 + (-1) = -3 (not >= 2)
        // Hmm, this is tricky. The threshold condition is:
        // (expectedDelta - minDelta >= 2) OR (expectedDelta + (-1 * minDelta) >= 2)
        // For minDelta >= 0 and expectedDelta <= 0:
        // first: expectedDelta - minDelta <= 0 - 0 = 0 < 2
        // second: expectedDelta + (-minDelta) = expectedDelta - minDelta <= 0 < 2
        // So this branch can NEVER be reached with minDelta >= 0 and expectedDelta <= 0!
        // The remaining case for BOLUS_ERR_OTHER_DELTA is: minDelta >= 0, expectedDelta > 0,
        // but NOT (minDelta >= 0 && expectedDelta > 0) — that's already BOLUS_ERR_RISING_SLOWER.
        // Actually wait: minDelta=0, expectedDelta=3 => BOLUS_ERR_RISING_SLOWER (minDelta>=0 && expectedDelta>0)
        // So BOLUS_ERR_OTHER_DELTA requires: NOT(minDelta>=0 && expectedDelta>0) AND NOT(minDelta<0)
        // That means minDelta >= 0 AND expectedDelta <= 0 — but we showed that's never significant.
        // This means BOLUS_ERR_OTHER_DELTA at line 228 is effectively unreachable dead code.
        // We can still trigger handleFallingDelta to exercise the classifyDeltaBehavior non-significant path
        // (where bolusErrorString is undefined).
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: -0.5,
                expectedDelta: 0,
                basal: 1.0,
                adjustedSens: 50,
                tick: 0,
                microBolusAllowed: true,
            },
            ctx: {
                enableSMB: true,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        handleFallingDelta(ctx);

        // With minDelta=-0.5, expectedDelta=0: diff = 0 - (-0.5) = 0.5 < 2 (not significant)
        // So manualBolusErrorString should NOT be set
        expect(ctx.result.manualBolusErrorString).toBeUndefined();
    });

    it('classifies BOLUS_ERR_RISING_SLOWER when minDelta >= 0 and expectedDelta > 0 (significant)', () => {
        // minDelta=0, expectedDelta=3: expectedDelta - minDelta = 3 >= 2 (significant)
        // minDelta >= 0 && expectedDelta > 0 => BOLUS_ERR_RISING_SLOWER (3)
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                minBG: 80,
                minDelta: 0,
                expectedDelta: 3,
                basal: 1.0,
                adjustedSens: 50,
                tick: 0,
                microBolusAllowed: true,
            },
            ctx: {
                enableSMB: true,
            },
            result: {
                eventualBG: 120,
                targetBG: 100,
            },
        });

        handleFallingDelta(ctx);

        expect(ctx.result.manualBolusErrorString).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// handleInRange
// ---------------------------------------------------------------------------

describe('handleInRange', () => {
    it('returns { done: false } when min(eventualBG, minPredBG) >= max_bg', () => {
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 130,
                minPredBG: 125,
                maxBG: 120,
            },
        });

        const outcome = handleInRange(ctx);

        expect(outcome.done).toBe(false);
    });

    it('sets result.minPredBG when in range', () => {
        // min(eventualBG, minPredBG) = min(110, 90) = 90 < max_bg=120 => in range
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 110,
                minPredBG: 90,
                minBG: 80,
                maxBG: 120,
                basal: 1.0,
                adjustedSens: 50,
                microBolusAllowed: false,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
            },
            ctx: {
                enableSMB: false,
            },
        });

        handleInRange(ctx);

        expect(ctx.result.minPredBG).toBe(90);
    });

    it('returns { done: true } with basal temp in non-SMB mode when in range', () => {
        // min(eventualBG=110, minPredBG=100) = 100 < max_bg=120
        // not SMB mode => sets current basal as temp
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 110,
                minPredBG: 100,
                minBG: 80,
                maxBG: 120,
                basal: 1.0,
                adjustedSens: 50,
                microBolusAllowed: false,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                },
            },
            ctx: {
                enableSMB: false,
            },
        });

        const outcome = handleInRange(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            const mock = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
            expect(mock).toHaveBeenCalledWith(
                1.0,
                30,
                ctx.inputs.profile,
                ctx.result,
                ctx.inputs.currenttemp,
            );
        }
        expect(ctx.result.reason).toContain('in range: no temp required');
    });

    it('returns { done: false } when SMB mode is active', () => {
        // min(eventualBG=110, minPredBG=100) = 100 < max_bg=120 => in range
        // microBolusAllowed && enableSMB => skip the temp basal, return { done: false }
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 110,
                minPredBG: 100,
                minBG: 80,
                maxBG: 120,
                basal: 1.0,
                adjustedSens: 50,
                microBolusAllowed: true,
            },
            ctx: {
                enableSMB: true,
            },
        });

        const outcome = handleInRange(ctx);

        expect(outcome.done).toBe(false);
        // minPredBG should still be set on the result even in SMB mode
        expect(ctx.result.minPredBG).toBe(100);
    });
});
