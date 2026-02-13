import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    initializeTelemetry,
    calculateCarbsContext,
    calculateCarbsRequired,
} from '../../../../src/determine-basal/dosing-decision/initialize';

import type { DosingContext } from '../../../../src/determine-basal/dosing-decision/types';
import type {
    DetermineBasalResult,
    Profile,
    IOBData,
    MealData,
    GlucoseStatus,
    CurrentTemp,
    TempBasalFunctions,
    TrioCustomVariables,
} from '../../../../src/types/index';
import type { DosingDecisionInputs } from '../../../../src/determine-basal/types';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeTestContext(overrides: Partial<DosingDecisionInputs> = {}): DosingContext {
    const defaultProfile = {
        out_units: 'mg/dL',
        current_basal: 1.0,
        carbsReqThreshold: 1,
    } as unknown as Profile;

    const defaultIobData = {
        iob: 1.5,
        activity: 0.01,
        basaliob: 0.5,
        bolusiob: 1.0,
        netbasalinsulin: 0.3,
        bolusinsulin: 1.0,
        time: new Date('2025-01-15T12:00:00.000Z'),
    } as unknown as IOBData;

    const defaultMealData: MealData = {
        carbs: 50,
        nsCarbs: 0,
        bwCarbs: 0,
        journalCarbs: 0,
        mealCOB: 20,
        currentDeviation: 10,
        maxDeviation: 15,
        minDeviation: -5,
        slopeFromMaxDeviation: -0.5,
        slopeFromMinDeviation: 0.5,
        allDeviations: [10, 12, 8],
        bwFound: false,
    };

    const defaultGlucoseStatus: GlucoseStatus = {
        glucose: 120,
        delta: 5,
        short_avgdelta: 4,
        long_avgdelta: 3,
    };

    const defaultCurrentTemp: CurrentTemp = {
        duration: 0,
        rate: 0,
    };

    const defaultTempBasalFunctions = {
        getMaxSafeBasal: vi.fn(() => 5),
        setTempBasal: vi.fn(),
    } as unknown as TempBasalFunctions;

    const defaultTrioCustomVariables: TrioCustomVariables = {
        useOverride: false,
        overridePercentage: 100,
        overrideTarget: 0,
        advancedSettings: false,
        isfAndCr: false,
        isf: false,
        cr: false,
        smbIsOff: false,
        smbIsScheduledOff: false,
        start: 0,
        end: 0,
        smbMinutes: 30,
        uamMinutes: 30,
        currentTDD: 0,
        average_total_data: 0,
        weightedAverage: 0,
        duration: 0,
    };

    const inputs: DosingDecisionInputs = {
        result: {} as DetermineBasalResult,
        iob_data: defaultIobData,
        meal_data: defaultMealData,
        profile: defaultProfile,
        glucose_status: defaultGlucoseStatus,
        currenttemp: defaultCurrentTemp,
        tempBasalFunctions: defaultTempBasalFunctions,
        systemTime: new Date('2025-01-15T12:00:00.000Z'),
        trio_custom_variables: defaultTrioCustomVariables,
        bg: 120,
        eventualBG: 110,
        naive_eventualBG: 110,
        threshold: 65,
        target_bg: 100,
        min_bg: 90,
        max_bg: 120,
        max_iob: 8,
        basal: 1.0,
        adjustedSens: 50,
        carbRatio: 10,
        overrideFactor: 1.0,
        expectedDelta: -2,
        minDelta: 3,
        maxDelta: 7,
        tick: '+3',
        bgImpact: -2.5,
        deviation: 8,
        carbImpact: 5,
        remainingCIpeak: 3,
        carbSensFactor: 5,
        minPredBG: 80,
        minGuardBG: 75,
        lastIOBpredBG: 90,
        lastCOBpredBG: 95,
        lastUAMpredBG: 85,
        minIOBPredBG: 70,
        IOBpredBGs: [120, 115, 110, 105, 100],
        COBpredBGs: [120, 118, 115, 112, 110],
        enableSMB: true,
        microBolusAllowed: true,
        isfreason: 'ISF reason test',
        targetLog: 100,
        tddReason: '',
        ...overrides,
    };

    return {
        inputs,
        result: inputs.result,
        enableSMB: inputs.enableSMB,
        bgUndershoot: 0,
        minutesAboveMinBG: 240,
        minutesAboveThreshold: 240,
        carbsReq: 0,
        insulinReq: 0,
        rate: 0,
        insulinScheduled: 0,
    };
}

// ---------------------------------------------------------------------------
// initializeTelemetry
// ---------------------------------------------------------------------------

describe('initializeTelemetry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('sets result.COB, IOB, BGI, deviation, ISF, CR, target_bg, current_target', () => {
        const ctx = makeTestContext({
            bgImpact: -3,
            deviation: 12,
            adjustedSens: 55,
            carbRatio: 10.456,
            target_bg: 105,
        });

        initializeTelemetry(ctx);

        // convert_bg with mg/dL profile just rounds to integer
        expect(ctx.result.COB).toBe(20);
        expect(ctx.result.IOB).toBe(1.5);
        expect(ctx.result.BGI).toBe(-3);
        expect(ctx.result.deviation).toBe(12);
        expect(ctx.result.ISF).toBe(55);
        expect(ctx.result.CR).toBe(10.5); // round(10.456, 1)
        expect(ctx.result.target_bg).toBe(105);
        expect(ctx.result.current_target).toBe(105); // round(105, 0)
    });

    it('builds reason string with isfreason, COB, Dev, BGI, CR, Target, minPredBG, minGuardBG, IOBpredBG', () => {
        const ctx = makeTestContext({
            isfreason: 'ISF: 50',
            targetLog: 100,
            minPredBG: 80,
            minGuardBG: 75,
            lastIOBpredBG: 90,
            lastCOBpredBG: 0,
            lastUAMpredBG: 0,
            tddReason: '',
        });

        initializeTelemetry(ctx);

        expect(ctx.result.reason).toContain('ISF: 50');
        expect(ctx.result.reason).toContain('COB: 20');
        expect(ctx.result.reason).toContain('Dev: ');
        expect(ctx.result.reason).toContain('BGI: ');
        expect(ctx.result.reason).toContain('CR: ');
        expect(ctx.result.reason).toContain('Target: 100');
        expect(ctx.result.reason).toContain('minPredBG 80');
        expect(ctx.result.reason).toContain('minGuardBG 75');
        expect(ctx.result.reason).toContain('IOBpredBG 90');
        // Should NOT contain COBpredBG or UAMpredBG when they are 0
        expect(ctx.result.reason).not.toContain('COBpredBG');
        expect(ctx.result.reason).not.toContain('UAMpredBG');
        // Ends with "; " for reason.conclusion
        expect(ctx.result.reason).toMatch(/; $/);
    });

    it('appends COBpredBG to reason when lastCOBpredBG > 0', () => {
        const ctx = makeTestContext({
            lastCOBpredBG: 95,
            lastUAMpredBG: 0,
        });

        initializeTelemetry(ctx);

        expect(ctx.result.reason).toContain('COBpredBG 95');
        expect(ctx.result.reason).not.toContain('UAMpredBG');
    });

    it('appends UAMpredBG to reason when lastUAMpredBG > 0', () => {
        const ctx = makeTestContext({
            lastCOBpredBG: 0,
            lastUAMpredBG: 85,
        });

        initializeTelemetry(ctx);

        expect(ctx.result.reason).toContain('UAMpredBG 85');
        expect(ctx.result.reason).not.toContain('COBpredBG');
    });

    it('always returns { done: false }', () => {
        const ctx = makeTestContext();
        const outcome = initializeTelemetry(ctx);
        expect(outcome).toEqual({ done: false });
    });
});

// ---------------------------------------------------------------------------
// calculateCarbsContext
// ---------------------------------------------------------------------------

describe('calculateCarbsContext', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('sets minutesAboveMinBG and minutesAboveThreshold to 240 when predictions stay above min_bg/threshold', () => {
        // All COBpredBGs stay well above min_bg (90) and threshold (65)
        const ctx = makeTestContext({
            COBpredBGs: [150, 140, 130, 120, 110],
            min_bg: 90,
            threshold: 65,
            carbImpact: 5,
            remainingCIpeak: 3,
        });
        // mealCOB > 0 is already default (20)

        calculateCarbsContext(ctx);

        expect(ctx.minutesAboveMinBG).toBe(240);
        expect(ctx.minutesAboveThreshold).toBe(240);
    });

    it('computes minutesAboveMinBG correctly when COBpredBGs drop below min_bg', () => {
        // COBpredBGs: index 0=120, 1=100, 2=85, 3=70 (< 90 at index 3)
        // PRED_INTERVAL_MINUTES = 5, so minutesAboveMinBG = 5 * 3 = 15
        const ctx = makeTestContext({
            COBpredBGs: [120, 100, 95, 70, 60],
            min_bg: 90,
            threshold: 65,
            carbImpact: 5,
            remainingCIpeak: 3,
        });

        calculateCarbsContext(ctx);

        // First index below min_bg (90) is index 3 (value 70)
        expect(ctx.minutesAboveMinBG).toBe(15); // 5 * 3
        // First index below threshold (65) is index 4 (value 60)
        expect(ctx.minutesAboveThreshold).toBe(20); // 5 * 4
    });

    it('uses IOBpredBGs when mealCOB is 0', () => {
        const mealData: MealData = {
            carbs: 0,
            nsCarbs: 0,
            bwCarbs: 0,
            journalCarbs: 0,
            mealCOB: 0,
            currentDeviation: 0,
            maxDeviation: 0,
            minDeviation: 0,
            slopeFromMaxDeviation: 0,
            slopeFromMinDeviation: 0,
            allDeviations: [],
            bwFound: false,
        };

        // IOBpredBGs: index 0=120, 1=100, 2=80 (< 90 at index 2)
        const ctx = makeTestContext({
            meal_data: mealData,
            IOBpredBGs: [120, 100, 80, 60, 50],
            COBpredBGs: [200, 200, 200, 200, 200], // should be ignored
            min_bg: 90,
            threshold: 65,
            carbImpact: 0,
            remainingCIpeak: 0,
        });

        calculateCarbsContext(ctx);

        // First IOBpredBG below min_bg (90) is index 2 (value 80)
        expect(ctx.minutesAboveMinBG).toBe(10); // 5 * 2
        // First IOBpredBG below threshold (65) is index 3 (value 60)
        expect(ctx.minutesAboveThreshold).toBe(15); // 5 * 3
    });

    it('computes bgUndershoot = threshold - carbsReqBG', () => {
        const ctx = makeTestContext({
            naive_eventualBG: 55,
            threshold: 65,
            minGuardBG: 60,
        });

        calculateCarbsContext(ctx);

        // naive_eventualBG (55) >= LOW_BG_SAFETY_THRESHOLD (40), so carbsReqBG = 55
        // bgUndershoot = 65 - 55 = 10
        expect(ctx.bgUndershoot).toBe(10);
    });

    it('uses minGuardBG when carbsReqBG < LOW_BG_SAFETY_THRESHOLD (40)', () => {
        const ctx = makeTestContext({
            naive_eventualBG: 35,
            threshold: 65,
            minGuardBG: 50,
        });

        calculateCarbsContext(ctx);

        // naive_eventualBG (35) < LOW_BG_SAFETY_THRESHOLD (40)
        // carbsReqBG = Math.min(minGuardBG=50, naive_eventualBG=35) = 35
        // bgUndershoot = 65 - 35 = 30
        expect(ctx.bgUndershoot).toBe(30);
    });
});

// ---------------------------------------------------------------------------
// calculateCarbsRequired
// ---------------------------------------------------------------------------

describe('calculateCarbsRequired', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    it('sets carbsReq on context and result when above threshold', () => {
        const profile = {
            out_units: 'mg/dL',
            current_basal: 1.0,
            carbsReqThreshold: 1,
        } as unknown as Profile;

        const ctx = makeTestContext({
            profile,
            adjustedSens: 50,
            overrideFactor: 1.0,
            carbSensFactor: 5,
        });

        // Set up carbs context state: high bgUndershoot, short minutesAboveThreshold
        ctx.bgUndershoot = 40;
        ctx.minutesAboveMinBG = 30;
        ctx.minutesAboveThreshold = 30;

        calculateCarbsRequired(ctx);

        // zeroTempEffect = current_basal(1) * overrideFactor(1) * adjustedSens(50) * zeroTempDuration(30) / 60 = 25
        // COBforCarbsReq = max(0, mealCOB(20) - 0.25 * carbs(50)) = max(0, 20 - 12.5) = 7.5
        // carbsReq = (bgUndershoot(40) - zeroTempEffect(25)) / carbSensFactor(5) - COBforCarbsReq(7.5)
        //          = (40 - 25) / 5 - 7.5
        //          = 15 / 5 - 7.5
        //          = 3 - 7.5
        //          = -4.5
        // round(-4.5) = -5, which is < carbsReqThreshold (1), so result.carbsReq is NOT set

        // Adjust for a scenario where carbsReq IS above threshold:
        ctx.bgUndershoot = 100;
        ctx.minutesAboveThreshold = 30;

        calculateCarbsRequired(ctx);

        // zeroTempEffect = 1 * 1 * 50 * 30 / 60 = 25
        // COBforCarbsReq = max(0, 20 - 12.5) = 7.5
        // carbsReq = (100 - 25) / 5 - 7.5 = 75/5 - 7.5 = 15 - 7.5 = 7.5
        // round(7.5) = 8
        expect(ctx.carbsReq).toBe(8);
        expect(ctx.result.carbsReq).toBe(8);
        expect(ctx.result.reason).toContain("8 add'l carbs req w/in 30m");
    });

    it('does not set result.carbsReq when carbsReq < carbsReqThreshold', () => {
        const profile = {
            out_units: 'mg/dL',
            current_basal: 1.0,
            carbsReqThreshold: 10,
        } as unknown as Profile;

        const ctx = makeTestContext({
            profile,
            adjustedSens: 50,
            overrideFactor: 1.0,
            carbSensFactor: 5,
        });

        ctx.bgUndershoot = 60;
        ctx.minutesAboveThreshold = 30;

        calculateCarbsRequired(ctx);

        // zeroTempEffect = 1 * 1 * 50 * 30 / 60 = 25
        // COBforCarbsReq = max(0, 20 - 12.5) = 7.5
        // carbsReq = (60 - 25) / 5 - 7.5 = 35/5 - 7.5 = 7 - 7.5 = -0.5
        // round(-0.5) = -0 in JS (Math.round(-0.5) === -0)
        expect(ctx.carbsReq).toBe(-0);
        expect(ctx.result.carbsReq).toBeUndefined();
    });

    it('does not set result.carbsReq when minutesAboveThreshold > 45', () => {
        const profile = {
            out_units: 'mg/dL',
            current_basal: 1.0,
            carbsReqThreshold: 1,
        } as unknown as Profile;

        const ctx = makeTestContext({
            profile,
            adjustedSens: 50,
            overrideFactor: 1.0,
            carbSensFactor: 5,
        });

        // High bgUndershoot so carbsReq would be above threshold,
        // but minutesAboveThreshold > CARBS_REQ_WINDOW_MINUTES (45)
        ctx.bgUndershoot = 200;
        ctx.minutesAboveThreshold = 50;

        calculateCarbsRequired(ctx);

        // zeroTempEffect = 1 * 1 * 50 * 50 / 60 = 41.67
        // COBforCarbsReq = max(0, 20 - 12.5) = 7.5
        // carbsReq = (200 - 41.67) / 5 - 7.5 = 158.33/5 - 7.5 = 31.67 - 7.5 = 24.17
        // round(24.17) = 24, which is >= carbsReqThreshold (1)
        // BUT minutesAboveThreshold (50) > CARBS_REQ_WINDOW_MINUTES (45)
        expect(ctx.carbsReq).toBe(24);
        expect(ctx.result.carbsReq).toBeUndefined();
    });

    it('always returns { done: false }', () => {
        const ctx = makeTestContext();
        ctx.bgUndershoot = 10;
        ctx.minutesAboveMinBG = 240;
        ctx.minutesAboveThreshold = 240;

        const outcome = calculateCarbsRequired(ctx);
        expect(outcome).toEqual({ done: false });
    });
});
