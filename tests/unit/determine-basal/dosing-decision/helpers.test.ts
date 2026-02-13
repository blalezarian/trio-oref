import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    keepOrSetBasalTemp,
    calculateZeroTempDuration,
    determineSMBMaxBolus,
    calculateSMBZeroTemp,
} from '../../../../src/determine-basal/dosing-decision/helpers';

import { findMinutesAbove } from '../../../../src/determine-basal/dosing-decision/initialize';

import type { DosingContext } from '../../../../src/determine-basal/dosing-decision/types';
import type {
    Profile,
    DetermineBasalResult,
    CurrentTemp,
    TempBasalFunctions,
    IOBData,
    MealData,
    GlucoseStatus,
    TrioCustomVariables,
} from '../../../../src/types/index';
import type { DosingDecisionInputs } from '../../../../src/determine-basal/types';

// ---------------------------------------------------------------------------
// Console mocking
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Test helper: make a DosingContext
// ---------------------------------------------------------------------------

function makeTestContext(overrides: {
    inputs?: Partial<DosingDecisionInputs>;
    result?: Partial<DetermineBasalResult>;
    enableSMB?: boolean;
    insulinReq?: number;
    rate?: number;
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
        } as MealData,
        profile: {
            current_basal: 1.0,
            out_units: 'mg/dL',
            max_basal: 4.0,
            bolus_increment: 0.1,
            smb_delivery_ratio: 0.5,
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
        } as TrioCustomVariables,
        microBolusAllowed: true,
        result: { reason: '' } as DetermineBasalResult,
        enableSMB: true,
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
// keepOrSetBasalTemp
// ---------------------------------------------------------------------------

describe('keepOrSetBasalTemp', () => {
    it('keeps existing temp when duration > 15 and rate matches basal', () => {
        const ctx = makeTestContext({
            inputs: {
                basal: 1.0,
                currenttemp: { rate: 1.0, duration: 20 } as CurrentTemp,
            },
        });

        const outcome = keepOrSetBasalTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('temp 1 ~ req 1U/hr');
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).not.toHaveBeenCalled();
    });

    it('sets new basal temp when duration <= 15', () => {
        const ctx = makeTestContext({
            inputs: {
                basal: 1.0,
                currenttemp: { rate: 1.0, duration: 10 } as CurrentTemp,
            },
        });

        const outcome = keepOrSetBasalTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('setting current basal of 1 as temp');
        const setTempBasal = ctx.inputs.tempBasalFunctions.setTempBasal as ReturnType<typeof vi.fn>;
        expect(setTempBasal).toHaveBeenCalledWith(1.0, 30, expect.anything(), expect.anything(), expect.anything());
    });

    it('sets new basal temp when rate does not match basal', () => {
        const ctx = makeTestContext({
            inputs: {
                basal: 1.0,
                currenttemp: { rate: 2.0, duration: 20 } as CurrentTemp,
            },
        });

        const outcome = keepOrSetBasalTemp(ctx);

        expect(outcome.done).toBe(true);
        expect(ctx.result.reason).toContain('setting current basal of 1 as temp');
    });
});

// ---------------------------------------------------------------------------
// calculateZeroTempDuration
// ---------------------------------------------------------------------------

describe('calculateZeroTempDuration', () => {
    // bgUndershoot / adjustedSens = worstCaseInsulinReq
    // durationReq = round(60 * worstCaseInsulinReq / current_basal * overrideFactor)
    // then rounded to 30m increments, clamped to [minDuration, 120]

    it('returns 0 when worstCaseInsulinReq is negative (BG above target)', () => {
        // bgUndershoot = -10 (target is below guard BG), adjustedSens=50
        // worstCaseInsulinReq = -10/50 = -0.2 → durationReq = round(60 * -0.2 / 1.0 * 1.0) = -12 → negative → return minDuration(0)
        const result = calculateZeroTempDuration(-10, 50, 1.0, 1.0);
        expect(result).toBe(0);
    });

    it('returns minimum duration when calculated duration is below minimum', () => {
        // Small undershoot: bgUndershoot=5, adjustedSens=50
        // worstCaseInsulinReq = 5/50 = 0.1 → durationReq = round(60 * 0.1 / 1.0 * 1.0) = 6
        // round(6/30)*30 = 0 → max(30, 0) = 30 (minDuration=30)
        const result = calculateZeroTempDuration(5, 50, 1.0, 1.0, 30);
        expect(result).toBe(30);
    });

    it('rounds up to 30m increments', () => {
        // bgUndershoot=50, adjustedSens=50
        // worstCaseInsulinReq = 50/50 = 1.0 → durationReq = round(60 * 1.0 / 1.0 * 1.0) = 60
        // round(60/30)*30 = 60 → min(120, max(0, 60)) = 60
        const result = calculateZeroTempDuration(50, 50, 1.0, 1.0);
        expect(result).toBe(60);
    });

    it('caps at MAX_TEMP_BASAL_DURATION_MINUTES (120)', () => {
        // bgUndershoot=200, adjustedSens=50
        // worstCaseInsulinReq = 200/50 = 4.0 → durationReq = round(60 * 4.0 / 1.0 * 1.0) = 240
        // round(240/30)*30 = 240 → min(120, max(0, 240)) = 120
        const result = calculateZeroTempDuration(200, 50, 1.0, 1.0);
        expect(result).toBe(120);
    });

    it('respects overrideFactor', () => {
        // bgUndershoot=50, adjustedSens=50, current_basal=1.0, overrideFactor=2.0
        // worstCaseInsulinReq = 50/50 = 1.0 → durationReq = round(60 * 1.0 / 1.0 * 2.0) = 120
        // min(120, max(0, 120)) = 120
        const result = calculateZeroTempDuration(50, 50, 1.0, 2.0);
        expect(result).toBe(120);
    });
});

// ---------------------------------------------------------------------------
// determineSMBMaxBolus
// ---------------------------------------------------------------------------

describe('determineSMBMaxBolus', () => {
    it('falls back to 30m when smbMinutesSetting is undefined', () => {
        // effectiveBasal=1.0, DEFAULT_MAX_SMB_BASAL_MINUTES=30
        // maxBolus = round(1.0 * 30 / 60, 1) = 0.5
        const result = determineSMBMaxBolus(1.0, 2.0, 0, 0, 1.0, undefined, undefined);
        expect(result).toBe(0.5);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('smbMinutesSetting undefined'));
    });

    it('does not log limitation when insulinReq <= maxBolus and smbMinutesSetting is undefined', () => {
        // insulinReq=0.3 <= maxBolus=0.5, smbMinutesSetting=undefined
        // Should log "smbMinutesSetting undefined" but NOT "SMB limited by maxBolus"
        const result = determineSMBMaxBolus(0.3, 2.0, 0, 0, 1.0, undefined, undefined);
        expect(result).toBe(0.5);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('smbMinutesSetting undefined'));
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('SMB limited by maxBolus'));
    });

    it('uses UAM minutes when IOB > mealInsulinReq', () => {
        // iob=5 > mealInsulinReq=2 and iob > 0
        // uamMinutesSetting=45, effectiveBasal=1.0
        // maxBolus = round(1.0 * 45 / 60, 1) = 0.8
        const result = determineSMBMaxBolus(1.0, 5.0, 20, 2.0, 1.0, 30, 45);
        expect(result).toBe(0.8);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('maxUAMSMBBasalMinutes: 45'));
    });

    it('falls back to 30m when UAM minutes is 0 (falsy) and IOB > mealInsulinReq', () => {
        // uamMinutesSetting=0 (falsy), effectiveBasal=1.0
        // maxBolus = round(1.0 * 30 / 60, 1) = 0.5
        const result = determineSMBMaxBolus(1.0, 5.0, 20, 2.0, 1.0, 30, 0);
        expect(result).toBe(0.5);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('maxUAMSMBBasalMinutes undefined'));
    });

    it('uses SMB minutes when IOB <= mealInsulinReq', () => {
        // iob=1 <= mealInsulinReq=5
        // smbMinutesSetting=60, effectiveBasal=1.0
        // maxBolus = round(1.0 * 60 / 60, 1) = 1.0
        const result = determineSMBMaxBolus(2.0, 1.0, 50, 5.0, 1.0, 60, 30);
        expect(result).toBe(1.0);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('.maxSMBBasalMinutes: 60'));
    });

    it('logs limitation message when insulinReq > maxBolus (SMB branch)', () => {
        // insulinReq=2.0 > maxBolus (0.5)
        determineSMBMaxBolus(2.0, 1.0, 50, 5.0, 1.0, 30, 30);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SMB limited by maxSMBBasalMinutes'));
    });

    it('logs not-limited message when insulinReq <= maxBolus (SMB branch)', () => {
        // insulinReq=0.1 <= maxBolus (0.5)
        determineSMBMaxBolus(0.1, 1.0, 50, 5.0, 1.0, 30, 30);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SMB is not limited by maxSMBBasalMinutes'));
    });

    it('scales with effectiveBasal', () => {
        // effectiveBasal=2.0, smbMinutesSetting=30
        // maxBolus = round(2.0 * 30 / 60, 1) = 1.0
        const result = determineSMBMaxBolus(0.5, 1.0, 50, 5.0, 2.0, 30, 30);
        expect(result).toBe(1.0);
    });
});

// ---------------------------------------------------------------------------
// calculateSMBZeroTemp
// ---------------------------------------------------------------------------

describe('calculateSMBZeroTemp', () => {
    it('returns durationReq=0 when worstCaseInsulinReq is negative', () => {
        // worstCaseInsulinReq=-0.5, current_basal=1.0, overrideFactor=1.0
        // durationReq = round(60 * -0.5 / 1.0 * 1.0) = -30 → clamped to 0
        const result = calculateSMBZeroTemp(1.0, 0.5, 0.1, -0.5, 1.0, 1.0, 1.0);
        expect(result.durationReq).toBe(0);
        expect(result.smbLowTempReq).toBe(0);
    });

    it('returns durationReq=0 when insulinReq > 0 but microBolus < bolusIncrement', () => {
        // insulinReq=0.05 > 0, microBolus=0.05 < bolusIncrement=0.1
        // worstCaseInsulinReq=0.5 → durationReq would be 30, but overridden to 0
        const result = calculateSMBZeroTemp(0.05, 0.05, 0.1, 0.5, 1.0, 1.0, 1.0);
        expect(result.durationReq).toBe(0);
        expect(result.smbLowTempReq).toBe(0);
    });

    it('rounds to 30m increments and caps at 60m when durationReq >= 30', () => {
        // worstCaseInsulinReq=0.7, current_basal=1.0, overrideFactor=1.0
        // durationReq = round(60 * 0.7 / 1.0 * 1.0) = 42
        // 42 >= 30 → round(42/30)*30 = round(1.4)*30 = 1*30 = 30
        // min(60, max(0, 30)) = 30
        const result = calculateSMBZeroTemp(1.0, 0.5, 0.1, 0.7, 1.0, 1.0, 1.0);
        expect(result.durationReq).toBe(30);
        expect(result.smbLowTempReq).toBe(0);
    });

    it('caps at SMB_MAX_ZERO_TEMP_MINUTES (60) for very large durationReq', () => {
        // worstCaseInsulinReq=2.0, current_basal=1.0, overrideFactor=1.0
        // durationReq = round(60 * 2.0 / 1.0 * 1.0) = 120
        // 120 >= 30 → round(120/30)*30 = 120 → min(60, max(0, 120)) = 60
        const result = calculateSMBZeroTemp(1.0, 0.5, 0.1, 2.0, 1.0, 1.0, 1.0);
        expect(result.durationReq).toBe(60);
        expect(result.smbLowTempReq).toBe(0);
    });

    it('sets nonzero low temp when durationReq > 0 and < 30', () => {
        // worstCaseInsulinReq=0.3, current_basal=1.0, overrideFactor=1.0
        // durationReq = round(60 * 0.3 / 1.0 * 1.0) = 18
        // 18 < 30 → smbLowTempReq = round(basal * 18 / 30, 2) = round(1.0 * 0.6, 2) = 0.6
        // durationReq = 30
        const result = calculateSMBZeroTemp(1.0, 0.5, 0.1, 0.3, 1.0, 1.0, 1.0);
        expect(result.durationReq).toBe(30);
        expect(result.smbLowTempReq).toBe(0.6);
    });

    it('scales with overrideFactor', () => {
        // worstCaseInsulinReq=0.5, current_basal=1.0, overrideFactor=2.0
        // durationReq = round(60 * 0.5 / 1.0 * 2.0) = 60
        // 60 >= 30 → round(60/30)*30 = 60 → min(60, max(0, 60)) = 60
        const result = calculateSMBZeroTemp(1.0, 0.5, 0.1, 0.5, 1.0, 2.0, 1.0);
        expect(result.durationReq).toBe(60);
    });
});

// ---------------------------------------------------------------------------
// findMinutesAbove
// ---------------------------------------------------------------------------

describe('findMinutesAbove', () => {
    it('returns PRED_HORIZON_MAX_MINUTES (240) when all values stay above level', () => {
        const result = findMinutesAbove([120, 115, 110, 105, 100], 80);
        expect(result).toBe(240);
    });

    it('returns 0 when first value is below level', () => {
        const result = findMinutesAbove([60, 70, 80], 80);
        expect(result).toBe(0);
    });

    it('returns correct minutes for first drop below level', () => {
        // index 3 (value 70) is first below 80; 3 * 5 = 15
        const result = findMinutesAbove([120, 100, 90, 70, 60], 80);
        expect(result).toBe(15);
    });

    it('returns 240 for empty array', () => {
        const result = findMinutesAbove([], 80);
        expect(result).toBe(240);
    });
});
