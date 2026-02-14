import type { DetermineBasalResult } from '../../types/index';
import type { DosingDecisionInputs } from '../types';

/** Mutable context object passed through the dosing pipeline phases. */
export interface DosingContext {
    /** Read-only inputs from the caller */
    readonly inputs: DosingDecisionInputs;

    /** Accumulating result object */
    result: DetermineBasalResult;

    /** SMB eligibility — may be disabled by safety guards */
    enableSMB: boolean;

    // --- From calculateCarbsContext → calculateCarbsRequired ---

    /** Difference between threshold and projected low BG (mg/dL) */
    bgUndershoot: number;
    /** Minutes until COB/IOB predictions drop below min_bg */
    minutesAboveMinBG: number;
    /** Minutes until COB/IOB predictions drop below threshold */
    minutesAboveThreshold: number;

    /** Carbs required to prevent hypo — set by calculateCarbsRequired, read by handleLowBG */
    carbsReq: number;

    // --- Cross-phase mutable state for temp/SMB calculations ---

    /** Additional insulin required (U) */
    insulinReq: number;
    /** Calculated temp basal rate (U/hr) */
    rate: number;
    /** Insulin scheduled by current temp (U) */
    insulinScheduled: number;
}

/** Outcome of a pipeline phase: either an early return with a result, or continue to the next phase. */
export type PhaseOutcome =
    | { done: true; result: DetermineBasalResult }
    | { done: false };

/** A single phase in the dosing decision pipeline. */
export type DosingPhase = (ctx: DosingContext) => PhaseOutcome;
