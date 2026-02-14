/**
 * Shared factory for DosingDecisionInputs and DosingContext.
 *
 * These are the largest factory objects in the test suite (~100-130 lines each).
 * Centralizing them here eliminates ~600 lines of near-identical duplication
 * across 6 dosing-decision test files.
 */

import type { DosingContext } from '../../../src/determineBasal/dosingDecision/types';
import type { DosingDecisionInputs } from '../../../src/determineBasal/types';
import type { DetermineBasalResult } from '../../../src/types/index';

import {
    makeIobData,
    makeMealData,
    makeProfile,
    makeGlucoseStatus,
    makeCurrentTemp,
    makeTempBasalFunctions,
    makeTrioCustomVariables,
    makeDetermineBasalResult,
    FIXED_DATE,
} from './factories';

// ---------------------------------------------------------------------------
// DosingDecisionInputs
// ---------------------------------------------------------------------------

/** Build a complete DosingDecisionInputs with sane defaults */
export function makeDosingInputs(
    overrides: Partial<DosingDecisionInputs> = {},
): DosingDecisionInputs {
    return {
        // --- Nested objects ---
        result: makeDetermineBasalResult(),
        iobData: makeIobData(),
        mealData: makeMealData(),
        profile: makeProfile(),
        glucoseStatus: makeGlucoseStatus({ glucose: 150, delta: 5, short_avgdelta: 4, long_avgdelta: 3 }),
        currenttemp: makeCurrentTemp(),
        tempBasalFunctions: makeTempBasalFunctions(),
        systemTime: FIXED_DATE,
        trioCustomVariables: makeTrioCustomVariables(),

        // --- Scalar fields ---
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
// DosingContext
// ---------------------------------------------------------------------------

/** Build a complete DosingContext wrapping DosingDecisionInputs */
export function makeDosingContext(overrides: {
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

    return {
        inputs: makeDosingInputs(inputOverrides),
        result: makeDetermineBasalResult(resultOverrides),
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
