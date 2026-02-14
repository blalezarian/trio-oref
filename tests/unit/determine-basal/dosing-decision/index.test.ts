import { describe, it, expect, vi, beforeEach } from 'vitest';

import { calculateDosingDecision } from '../../../../src/determineBasal/dosingDecision/index';

import type {
    IOBData,
    MealData,
    Profile,
    GlucoseStatus,
    CurrentTemp,
    TempBasalFunctions,
    DetermineBasalResult,
    TrioCustomVariables,
} from '../../../../src/types/index';
import type { DosingDecisionInputs } from '../../../../src/determineBasal/types';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeDosingInputs(overrides: Partial<DosingDecisionInputs> = {}): DosingDecisionInputs {
    return {
        result: { reason: '' } as DetermineBasalResult,
        iobData: {
            iob: 2.0,
            lastBolusTime: new Date(FIXED_TIME).getTime() - 600000,
            activity: 0.05,
            basaliob: 0.5,
            bolusiob: 1.5,
            netbasalinsulin: 0.5,
            bolusinsulin: 3.0,
            time: new Date(FIXED_TIME),
        } as IOBData,
        mealData: {
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
        glucoseStatus: {
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
        systemTime: new Date(FIXED_TIME),
        trioCustomVariables: {
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
        bg: 150,
        eventualBG: 150,
        naiveEventualBG: 150,
        threshold: 65,
        targetBG: 100,
        minBG: 80,
        maxBG: 120,
        maxIOB: 10,
        basal: 1.0,
        adjustedSens: 50,
        carbRatio: 10,
        overrideFactor: 1.0,
        expectedDelta: 0,
        minDelta: 0,
        maxDelta: 0,
        tick: 0,
        bgImpact: 0,
        deviation: 0,
        carbImpact: 0,
        remainingCIpeak: 0,
        carbSensFactor: 0,
        minPredBG: 130,
        minGuardBG: 130,
        lastIOBpredBG: 120,
        lastCOBpredBG: 130,
        lastUAMpredBG: 130,
        minIOBPredBG: 120,
        IOBpredBGs: [],
        COBpredBGs: [],
        enableSMB: false,
        microBolusAllowed: false,
        isfreason: '',
        targetLog: '',
        tddReason: '',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// calculateDosingDecision
// ---------------------------------------------------------------------------

describe('calculateDosingDecision', () => {
    it('returns a DetermineBasalResult from the pipeline', () => {
        // With eventualBG=150 > max_bg=120 and non-SMB mode, the pipeline should
        // proceed through phases and return from applyFinalHighTemp.
        const inputs = makeDosingInputs();
        const result = calculateDosingDecision(inputs);

        // The pipeline always terminates before the unreachable line 57 fallthrough
        expect(result).toBeDefined();
        expect(typeof result.reason).toBe('string');
    });

    it('returns early from handleLowBG when eventualBG < min_bg', () => {
        // eventualBG=60 < min_bg=80 triggers handleLowBG early return
        const inputs = makeDosingInputs({
            eventualBG: 60,
            naiveEventualBG: 60,
            minDelta: -1,
            expectedDelta: 0,
        });
        const result = calculateDosingDecision(inputs);

        expect(result).toBeDefined();
        expect(result.reason).toContain('Eventual BG');
    });
});
