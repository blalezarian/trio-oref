import type { DetermineBasalResult } from '../../types/index';
import type { DosingDecisionInputs } from '../types';
import type { DosingContext, DosingPhase } from './types';

import { initializeTelemetry, calculateCarbsContext, calculateCarbsRequired } from './initialize';
import { enforceSMBSafetyGuards, checkPredictiveLGS, checkTopOfHourCancel } from './safety';
import { handleLowBG, handleFallingDelta, handleInRange } from './low-temp';
import { checkIOBLimit, calculateHighInsulinReq, handleSMB, applyFinalHighTemp } from './high-temp';

/** Ordered pipeline of dosing decision phases. Each phase either returns early or continues to the next. */
const phases: DosingPhase[] = [
    initializeTelemetry,
    calculateCarbsContext,
    enforceSMBSafetyGuards,
    calculateCarbsRequired,
    checkPredictiveLGS,
    checkTopOfHourCancel,
    handleLowBG,
    handleFallingDelta,
    handleInRange,
    checkIOBLimit,
    calculateHighInsulinReq,
    handleSMB,
    applyFinalHighTemp,
];

/** Creates the initial DosingContext from inputs. */
function createInitialContext(inputs: DosingDecisionInputs): DosingContext {
    return {
        inputs,
        result: inputs.result,
        enableSMB: inputs.enableSMB,

        // Carbs context (populated by calculateCarbsContext)
        bgUndershoot: 0,
        minutesAboveMinBG: 0,
        minutesAboveThreshold: 0,
        carbsReq: 0,

        // Temp/SMB state (populated by low-temp and high-temp phases)
        insulinReq: 0,
        rate: inputs.basal,
        insulinScheduled: 0,
    };
}

/** Calculates the final dosing decision (temp basal rate/duration, SMB, or no change) based on predictions, targets, and safety checks. */
export function calculateDosingDecision(inputs: DosingDecisionInputs): DetermineBasalResult {
    const ctx = createInitialContext(inputs);

    for (const phase of phases) {
        const outcome = phase(ctx);
        if (outcome.done) return outcome.result;
    }

    // applyFinalHighTemp always returns done — this is unreachable
    return ctx.result;
}
