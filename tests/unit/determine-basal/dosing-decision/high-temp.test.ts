import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    checkIOBLimit,
    calculateHighInsulinReq,
    handleSMB,
    applyFinalHighTemp,
    resolveSMBMinuteSettings,
    resolveSMBInterval,
} from '../../../../src/determine-basal/dosing-decision/high-temp';

import type { DosingContext } from '../../../../src/determine-basal/dosing-decision/types';
import type {
    IOBData,
    MealData,
    Profile,
    DetermineBasalResult,
    GlucoseStatus,
    CurrentTemp,
    TrioCustomVariables,
    TempBasalFunctions,
} from '../../../../src/types/index';
import type { DosingDecisionInputs } from '../../../../src/determine-basal/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestContext(overrides: {
    inputs?: Partial<DosingDecisionInputs>;
    result?: Partial<DetermineBasalResult>;
    enableSMB?: boolean;
    insulinReq?: number;
    rate?: number;
    insulinScheduled?: number;
    bgUndershoot?: number;
    minutesAboveMinBG?: number;
    minutesAboveThreshold?: number;
    carbsReq?: number;
} = {}): DosingContext {
    const {
        inputs: inputOverrides = {},
        result: resultOverrides = {},
        ...ctxOverrides
    } = overrides;

    const defaultInputs: DosingDecisionInputs = {
        basal: 1.0,
        adjustedSens: 50,
        threshold: 65,
        target_bg: 100,
        min_bg: 80,
        max_bg: 120,
        max_iob: 10,
        eventualBG: 150,
        minPredBG: 130,
        minIOBPredBG: 120,
        naive_eventualBG: 150,
        overrideFactor: 1.0,
        carbRatio: 10,
        bg: 150,
        iob_data: {
            iob: 2.0,
            lastBolusTime: Date.now() - 600000,
            activity: 0.05,
            basaliob: 0.5,
            bolusiob: 1.5,
            netbasalinsulin: 0.5,
            bolusinsulin: 3.0,
            time: new Date('2025-01-15T12:00:00Z'),
        } as IOBData,
        meal_data: {
            mealCOB: 0,
            carbs: 0,
            nsCarbs: 0,
            bwCarbs: 0,
            journalCarbs: 0,
            currentDeviation: 0,
            maxDeviation: 0,
            minDeviation: 0,
            slopeFromMaxDeviation: 0,
            slopeFromMinDeviation: 0,
            allDeviations: [],
            bwFound: false,
        } as MealData,
        profile: {
            current_basal: 1.0,
            out_units: 'mg/dL',
            max_basal: 4.0,
            maxSMBBasalMinutes: 30,
            maxUAMSMBBasalMinutes: 30,
            bolus_increment: 0.1,
            smb_delivery_ratio: 0.5,
            max_iob: 10,
            max_daily_safety_multiplier: 3,
            current_basal_safety_multiplier: 4,
            autosens_max: 1.2,
            autosens_min: 0.7,
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            max_daily_basal: 2.0,
            min_bg: 80,
            max_bg: 120,
            sens: 50,
            carb_ratio: 10,
        } as Profile,
        glucose_status: {
            glucose: 150,
            delta: 5,
            short_avgdelta: 4,
            long_avgdelta: 3,
        } as GlucoseStatus,
        currenttemp: {
            rate: 0,
            duration: 0,
        } as CurrentTemp,
        tempBasalFunctions: {
            setTempBasal: vi.fn(
                (
                    _rate: number,
                    _duration: number,
                    _profile: Profile,
                    result: DetermineBasalResult,
                ) => result,
            ),
            getMaxSafeBasal: vi.fn(() => 4),
        } as unknown as TempBasalFunctions,
        systemTime: new Date('2025-01-15T12:00:00Z'),
        trio_custom_variables: {
            useOverride: false,
            advancedSettings: false,
            smbMinutes: 30,
            uamMinutes: 30,
            overridePercentage: 100,
            overrideTarget: 0,
            isfAndCr: false,
            isf: false,
            cr: false,
            smbIsOff: false,
            smbIsScheduledOff: false,
            start: 0,
            end: 0,
            currentTDD: 0,
            average_total_data: 0,
            weightedAverage: 0,
            duration: 0,
        } as TrioCustomVariables,
        microBolusAllowed: true,
        result: { reason: '' } as DetermineBasalResult,
        enableSMB: true,

        // Remaining DosingDecisionInputs fields
        expectedDelta: 0,
        minDelta: 0,
        maxDelta: 0,
        tick: 0,
        bgImpact: 0,
        deviation: 0,
        carbImpact: 0,
        remainingCIpeak: 0,
        carbSensFactor: 0,
        minGuardBG: 130,
        lastIOBpredBG: 120,
        lastCOBpredBG: 130,
        lastUAMpredBG: 130,
        IOBpredBGs: [],
        COBpredBGs: [],
        isfreason: '',
        targetLog: '',
        tddReason: '',

        ...inputOverrides,
    };

    const defaultResult: DetermineBasalResult = {
        reason: '',
        ...resultOverrides,
    };

    return {
        inputs: defaultInputs,
        result: defaultResult,
        enableSMB: true,
        insulinReq: 1.0,
        rate: 3.0,
        insulinScheduled: 0,
        bgUndershoot: 0,
        minutesAboveMinBG: 0,
        minutesAboveThreshold: 0,
        carbsReq: 0,
        ...ctxOverrides,
    };
}

// ---------------------------------------------------------------------------
// Console mocking
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Phase 10: checkIOBLimit
// ---------------------------------------------------------------------------

describe('checkIOBLimit', () => {
    it('returns { done: false } when IOB <= max_iob', () => {
        // iob=2.0, max_iob=10 → IOB not over limit → continue pipeline
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 110,
                max_bg: 120,
            },
        });

        const outcome = checkIOBLimit(ctx);

        expect(outcome.done).toBe(false);
    });

    it('appends reason when eventualBG >= max_bg', () => {
        // eventualBG=120 >= max_bg=120 → appends "Eventual BG ... >= ..."
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 120,
                max_bg: 120,
            },
        });

        checkIOBLimit(ctx);

        expect(ctx.result.reason).toContain('Eventual BG');
        expect(ctx.result.reason).toContain('>= 120');
    });

    it('returns { done: true } when IOB > max_iob (cancels to basal)', () => {
        // iob=11 > max_iob=10 → sets basal as temp and returns done
        const ctx = makeTestContext({
            inputs: {
                iob_data: {
                    iob: 11,
                    lastBolusTime: Date.now() - 600000,
                    activity: 0.05,
                    basaliob: 0.5,
                    bolusiob: 10.5,
                    netbasalinsulin: 0.5,
                    bolusinsulin: 10.5,
                    time: new Date('2025-01-15T12:00:00Z'),
                } as IOBData,
                max_iob: 10,
                eventualBG: 110,
                max_bg: 120,
            },
        });

        const outcome = checkIOBLimit(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('IOB');
        expect(ctx.result.reason).toContain('> max_iob 10');
        // setTempBasal should have been called with basal rate
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).toHaveBeenCalledWith(
            1.0,
            30,
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
    });

    it('sets insulinForManualBolus when eventualBG > max_bg', () => {
        // eventualBG=150 > max_bg=120 → insulinForManualBolus = round((150-100)/50, 2) = 1.0
        const ctx = makeTestContext({
            inputs: {
                eventualBG: 150,
                max_bg: 120,
                target_bg: 100,
                adjustedSens: 50,
            },
        });

        checkIOBLimit(ctx);

        expect(ctx.result.insulinForManualBolus).toBe(1.0);
    });
});

// ---------------------------------------------------------------------------
// Phase 11: calculateHighInsulinReq
// ---------------------------------------------------------------------------

describe('calculateHighInsulinReq', () => {
    it('computes insulinReq = (min(minPredBG, eventualBG) - target_bg) / adjustedSens', () => {
        // min(130, 150) = 130; insulinReq = (130 - 100) / 50 = 0.6
        const ctx = makeTestContext({
            inputs: {
                minPredBG: 130,
                eventualBG: 150,
                target_bg: 100,
                adjustedSens: 50,
            },
        });

        calculateHighInsulinReq(ctx);

        expect(ctx.insulinReq).toBe(0.6);
    });

    it('caps insulinReq at max_iob - iob when insulinReq exceeds remaining IOB allowance', () => {
        // insulinReq = (min(190, 200) - 100) / 50 = 1.8
        // remaining = max_iob(3) - iob(2) = 1 → caps at 1
        const ctx = makeTestContext({
            inputs: {
                minPredBG: 190,
                eventualBG: 200,
                target_bg: 100,
                adjustedSens: 50,
                max_iob: 3,
                iob_data: {
                    iob: 2.0,
                    lastBolusTime: Date.now() - 600000,
                    activity: 0.05,
                    basaliob: 0.5,
                    bolusiob: 1.5,
                    netbasalinsulin: 0.5,
                    bolusinsulin: 3.0,
                    time: new Date('2025-01-15T12:00:00Z'),
                } as IOBData,
            },
        });

        calculateHighInsulinReq(ctx);

        expect(ctx.insulinReq).toBe(1);
        expect(ctx.result.reason).toContain('max_iob 3');
    });

    it('sets ctx.rate = basal + 2 * insulinReq (rounded to pump increment)', () => {
        // insulinReq = (130 - 100) / 50 = 0.6
        // rate = 1.0 + 2 * 0.6 = 2.2 → round_basal(2.2, profile) = 2.2
        const ctx = makeTestContext({
            inputs: {
                minPredBG: 130,
                eventualBG: 150,
                target_bg: 100,
                adjustedSens: 50,
                basal: 1.0,
            },
        });

        calculateHighInsulinReq(ctx);

        // LOW_TEMP_CORRECTION_FACTOR = 2
        // rate = 1.0 + 2 * 0.6 = 2.2, round_basal(2.2) = 2.2
        expect(ctx.rate).toBe(2.2);
    });

    it('stores insulinReq on result', () => {
        const ctx = makeTestContext({
            inputs: {
                minPredBG: 130,
                eventualBG: 150,
                target_bg: 100,
                adjustedSens: 50,
            },
        });

        calculateHighInsulinReq(ctx);

        expect(ctx.result.insulinReq).toBe(ctx.insulinReq);
    });

    it('always returns { done: false }', () => {
        const ctx = makeTestContext();

        const outcome = calculateHighInsulinReq(ctx);

        expect(outcome.done).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Phase 12: handleSMB
// ---------------------------------------------------------------------------

describe('handleSMB', () => {
    it('returns { done: false } when microBolusAllowed is false', () => {
        const ctx = makeTestContext({
            inputs: {
                microBolusAllowed: false,
            },
        });

        const outcome = handleSMB(ctx);

        expect(outcome.done).toBe(false);
    });

    it('returns { done: false } when enableSMB is false', () => {
        const ctx = makeTestContext({
            enableSMB: false,
        });

        const outcome = handleSMB(ctx);

        expect(outcome.done).toBe(false);
    });

    it('returns { done: false } when bg <= threshold', () => {
        const ctx = makeTestContext({
            inputs: {
                bg: 65,
                threshold: 65,
            },
        });

        const outcome = handleSMB(ctx);

        expect(outcome.done).toBe(false);
    });

    it('calculates microBolus correctly and sets result.units when lastBolusAge > SMBInterval', () => {
        // lastBolusTime 10 minutes ago → lastBolusAge = 10 > SMBInterval(3)
        // insulinReq = 1.0, smb_delivery_ratio = 0.5 → microBolus candidate = 0.5
        // maxBolus = current_basal(1.0) * overrideFactor(1.0) * 30 / 60 = 0.5
        // microBolus = min(0.5, 0.5) = 0.5
        // floor(0.5 * 10) / 10 = 0.5
        const ctx = makeTestContext({
            inputs: {
                bg: 150,
                threshold: 65,
                microBolusAllowed: true,
                iob_data: {
                    iob: 2.0,
                    lastBolusTime: Date.now() - 600000,
                    activity: 0.05,
                    basaliob: 0.5,
                    bolusiob: 1.5,
                    netbasalinsulin: 0.5,
                    bolusinsulin: 3.0,
                    time: new Date('2025-01-15T12:00:00Z'),
                } as IOBData,
                systemTime: new Date(),
            },
            enableSMB: true,
            insulinReq: 1.0,
        });

        const outcome = handleSMB(ctx);

        expect(ctx.result.units).toBe(0.5);
        expect(ctx.result.reason).toContain('Microbolusing 0.5U');
    });

    it('uses default SMB/UAM minutes when profile values are undefined', () => {
        // When maxSMBBasalMinutes and maxUAMSMBBasalMinutes are undefined on the profile,
        // handleSMB should default both to DEFAULT_MAX_SMB_BASAL_MINUTES (30)
        const ctx = makeTestContext({
            inputs: {
                bg: 150,
                threshold: 65,
                microBolusAllowed: true,
                iob_data: {
                    iob: 2.0,
                    lastBolusTime: Date.now() - 600000,
                    activity: 0.05,
                    basaliob: 0.5,
                    bolusiob: 1.5,
                    netbasalinsulin: 0.5,
                    bolusinsulin: 3.0,
                    time: new Date('2025-01-15T12:00:00Z'),
                } as IOBData,
                systemTime: new Date(),
                profile: {
                    current_basal: 1.0,
                    out_units: 'mg/dL',
                    max_basal: 4.0,
                    // maxSMBBasalMinutes and maxUAMSMBBasalMinutes intentionally omitted (undefined)
                    bolus_increment: 0.1,
                    smb_delivery_ratio: 0.5,
                    max_iob: 10,
                    max_daily_safety_multiplier: 3,
                    current_basal_safety_multiplier: 4,
                    autosens_max: 1.2,
                    autosens_min: 0.7,
                    dia: 5,
                    curve: 'rapid-acting',
                    useCustomPeakTime: false,
                    insulinPeakTime: 75,
                    max_daily_basal: 2.0,
                    min_bg: 80,
                    max_bg: 120,
                    sens: 50,
                    carb_ratio: 10,
                } as Profile,
            },
            enableSMB: true,
            insulinReq: 1.0,
        });

        const outcome = handleSMB(ctx);

        // Should complete without error; SMB minutes default to 30
        expect(outcome).toBeDefined();
    });

    it('returns { done: true } when durationReq > 0 (zero temp needed)', () => {
        // Set up conditions where worstCaseInsulinReq produces positive durationReq:
        // smbTarget = target_bg = 100
        // worstCaseInsulinReq = (100 - (150 + 120)/2) / 50 = (100 - 135) / 50 = -0.7
        // durationReq = round(60 * (-0.7) / 1.0 * 1.0) = round(-42) = -42 → clamped to 0
        //
        // To get durationReq > 0, we need worstCaseInsulinReq < 0 with negative sign:
        // Actually: durationReq = round(60 * worstCaseInsulinReq / current_basal * overrideFactor)
        // We need worstCaseInsulinReq < 0 (BG predicted below target)
        // which means smbTarget < (naive_eventualBG + minIOBPredBG) / 2
        // That gives negative worstCaseInsulinReq and negative durationReq → clamped to 0
        //
        // For positive durationReq, worstCaseInsulinReq > 0:
        // smbTarget > (naive_eventualBG + minIOBPredBG) / 2
        // 100 > (naive_eventualBG + minIOBPredBG) / 2
        // naive_eventualBG + minIOBPredBG < 200
        const ctx = makeTestContext({
            inputs: {
                bg: 150,
                threshold: 65,
                target_bg: 100,
                naive_eventualBG: 70,
                minIOBPredBG: 60,
                adjustedSens: 50,
                microBolusAllowed: true,
                iob_data: {
                    iob: 2.0,
                    lastBolusTime: Date.now() - 600000,
                    activity: 0.05,
                    basaliob: 0.5,
                    bolusiob: 1.5,
                    netbasalinsulin: 0.5,
                    bolusinsulin: 3.0,
                    time: new Date('2025-01-15T12:00:00Z'),
                } as IOBData,
                systemTime: new Date(),
                profile: {
                    current_basal: 1.0,
                    out_units: 'mg/dL',
                    max_basal: 4.0,
                    maxSMBBasalMinutes: 30,
                    maxUAMSMBBasalMinutes: 30,
                    bolus_increment: 0.1,
                    smb_delivery_ratio: 0.5,
                    max_iob: 10,
                    max_daily_safety_multiplier: 3,
                    current_basal_safety_multiplier: 4,
                    autosens_max: 1.2,
                    autosens_min: 0.7,
                    dia: 5,
                    curve: 'rapid-acting',
                    useCustomPeakTime: false,
                    insulinPeakTime: 75,
                    max_daily_basal: 2.0,
                    min_bg: 80,
                    max_bg: 120,
                    sens: 50,
                    carb_ratio: 10,
                } as Profile,
            },
            enableSMB: true,
            insulinReq: 1.0,
        });

        // worstCaseInsulinReq = (100 - (70 + 60)/2) / 50 = (100 - 65) / 50 = 0.7
        // durationReq = round(60 * 0.7 / 1.0 * 1.0) = round(42) = 42
        // 42 >= 30 → durationReq = round(42/30)*30 = 30; min(60, max(0, 30)) = 30
        const outcome = handleSMB(ctx);

        expect(outcome.done).toBe(true);
        if (outcome.done) {
            expect(outcome.result.duration).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// Phase 13: applyFinalHighTemp
// ---------------------------------------------------------------------------

describe('applyFinalHighTemp', () => {
    it('caps rate at maxSafeBasal when rate exceeds it', () => {
        const ctx = makeTestContext({
            rate: 5.0,
            inputs: {
                tempBasalFunctions: {
                    setTempBasal: vi.fn(
                        (
                            _rate: number,
                            _duration: number,
                            _profile: Profile,
                            result: DetermineBasalResult,
                        ) => result,
                    ),
                    getMaxSafeBasal: vi.fn(() => 3.0),
                } as unknown as TempBasalFunctions,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                } as CurrentTemp,
            },
        });

        applyFinalHighTemp(ctx);

        // rate should be capped to 3.0 (round_basal(3.0) = 3.0)
        expect(ctx.rate).toBe(3.0);
        expect(ctx.result.reason).toContain('maxSafeBasal');
    });

    it('returns { done: true } with setTempBasal when insulinScheduled >= 2 * insulinReq', () => {
        // currenttemp.duration=30, currenttemp.rate=5.0, basal=1.0
        // insulinScheduled = 30 * (5.0 - 1.0) / 60 = 2.0
        // insulinReq = 0.5 → 2 * 0.5 = 1.0 → 2.0 >= 1.0 → overshoot
        const ctx = makeTestContext({
            rate: 2.0,
            insulinReq: 0.5,
            inputs: {
                basal: 1.0,
                currenttemp: {
                    rate: 5.0,
                    duration: 30,
                } as CurrentTemp,
            },
        });

        const outcome = applyFinalHighTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('> 2 * insulinReq');
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).toHaveBeenCalled();
    });

    it('returns { done: true } when no current temp (duration === 0)', () => {
        const ctx = makeTestContext({
            rate: 2.0,
            insulinReq: 1.0,
            inputs: {
                basal: 1.0,
                currenttemp: {
                    rate: 0,
                    duration: 0,
                } as CurrentTemp,
            },
        });

        const outcome = applyFinalHighTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('no temp');
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).toHaveBeenCalled();
    });

    it('returns { done: true } when current temp rate > required rate (keeps existing temp)', () => {
        // currenttemp.duration=20 (> TEMP_SHORT_DURATION_MINUTES=5)
        // currenttemp.rate=3.0 >= ctx.rate=2.0 → keeps existing
        // insulinScheduled = 20 * (3.0 - 1.0) / 60 = 0.667
        // 2 * insulinReq = 2 * 1.0 = 2.0 → 0.667 < 2.0 → no overshoot
        const ctx = makeTestContext({
            rate: 2.0,
            insulinReq: 1.0,
            inputs: {
                basal: 1.0,
                currenttemp: {
                    rate: 3.0,
                    duration: 20,
                } as CurrentTemp,
            },
        });

        const outcome = applyFinalHighTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('temp 3 >~ req 2U/hr');
        // setTempBasal should NOT be called — existing temp is kept
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// resolveSMBMinuteSettings
// ---------------------------------------------------------------------------

describe('resolveSMBMinuteSettings', () => {
    it('uses profile values when no override', () => {
        const profile = { maxSMBBasalMinutes: 45, maxUAMSMBBasalMinutes: 60 } as Profile;
        const trio = { useOverride: false, advancedSettings: false, smbMinutes: 30, uamMinutes: 30 } as TrioCustomVariables;

        const result = resolveSMBMinuteSettings(profile, trio);

        expect(result.smbMinutesSetting).toBe(45);
        expect(result.uamMinutesSetting).toBe(60);
    });

    it('defaults to DEFAULT_MAX_SMB_BASAL_MINUTES (30) when profile values are undefined', () => {
        const profile = {} as Profile;
        const trio = { useOverride: false, advancedSettings: false, smbMinutes: 30, uamMinutes: 30 } as TrioCustomVariables;

        const result = resolveSMBMinuteSettings(profile, trio);

        expect(result.smbMinutesSetting).toBe(30);
        expect(result.uamMinutesSetting).toBe(30);
    });

    it('applies override when useOverride and advancedSettings are true and values differ', () => {
        const profile = { maxSMBBasalMinutes: 30, maxUAMSMBBasalMinutes: 30 } as Profile;
        const trio = { useOverride: true, advancedSettings: true, smbMinutes: 60, uamMinutes: 90 } as TrioCustomVariables;

        const result = resolveSMBMinuteSettings(profile, trio);

        expect(result.smbMinutesSetting).toBe(60);
        expect(result.uamMinutesSetting).toBe(90);
    });

    it('does not apply override when advancedSettings is false', () => {
        const profile = { maxSMBBasalMinutes: 30, maxUAMSMBBasalMinutes: 30 } as Profile;
        const trio = { useOverride: true, advancedSettings: false, smbMinutes: 60, uamMinutes: 90 } as TrioCustomVariables;

        const result = resolveSMBMinuteSettings(profile, trio);

        expect(result.smbMinutesSetting).toBe(30);
        expect(result.uamMinutesSetting).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// resolveSMBInterval
// ---------------------------------------------------------------------------

describe('resolveSMBInterval', () => {
    it('returns DEFAULT_SMB_INTERVAL_MINUTES (3) when profile.SMBInterval is undefined', () => {
        const profile = {} as Profile;
        expect(resolveSMBInterval(profile)).toBe(3);
    });

    it('returns DEFAULT_SMB_INTERVAL_MINUTES (3) when profile.SMBInterval is 0 (falsy)', () => {
        const profile = { SMBInterval: 0 } as Profile;
        expect(resolveSMBInterval(profile)).toBe(3);
    });

    it('returns profile.SMBInterval when within bounds [1, 10]', () => {
        const profile = { SMBInterval: 5 } as Profile;
        expect(resolveSMBInterval(profile)).toBe(5);
    });

    it('clamps to MIN_SMB_INTERVAL_MINUTES (1) when below', () => {
        const profile = { SMBInterval: 0.5 } as Profile;
        expect(resolveSMBInterval(profile)).toBe(1);
    });

    it('clamps to MAX_SMB_INTERVAL_MINUTES (10) when above', () => {
        const profile = { SMBInterval: 15 } as Profile;
        expect(resolveSMBInterval(profile)).toBe(10);
    });
});
