/*
  Determine Basal
  Released under MIT license. See the accompanying LICENSE.txt file for
  full terms and conditions
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/

import {
    PRED_INTERVAL_MINUTES,
} from '../shared/constants';

import type {
    GlucoseStatus,
    CurrentTemp,
    IOBData,
    BasalEntry,
    Profile,
    AutosensData,
    MealData,
    TempBasalFunctions,
    Preferences,
    DetermineBasalResult,
    TrioCustomVariables,
    ISODateString,
} from '../types/index';

import {
    OVERRIDE_TARGET_SENTINEL,
    DEFAULT_TRIO_CUSTOM_VARIABLES,
} from './constants';

import { round } from '../utils/rounding';
import { convertBG, calculateExpectedDelta, validateIOBAndTemps, projectEventualBG } from './helpers';
import { enableSMB as checkSMBEnabled } from './smbEligibility';
import { calculateDynamicISF } from './dynamicIsf';
import { validateCGMData } from './cgmValidation';
import { configureSensitivityAndTargets } from './sensitivityTargets';
import { calculateCarbAbsorption } from './carbAbsorption';
import { generateBGPredictions } from './bgPredictions';
import { calculateDosingDecision } from './dosingDecision';

/** Main determine-basal entry point: calculates the recommended temp basal / SMB dosing action. */
export function determineBasal(
    glucoseStatus: GlucoseStatus,
    currenttemp: CurrentTemp,
    iobData: IOBData[],
    profile: Profile,
    autosensData: AutosensData,
    mealData: MealData,
    tempBasalFunctions: TempBasalFunctions,
    microBolusAllowed: boolean,
    reservoirData: number | undefined,
    currentTime: Date | ISODateString = new Date(),
    _pumpHistory: unknown[],
    preferences: Preferences,
    _basalProfile: BasalEntry[] | undefined,
    trioCustomVariables?: TrioCustomVariables,
    middleWare?: string
): DetermineBasalResult {

    if (!trioCustomVariables) {
        trioCustomVariables = DEFAULT_TRIO_CUSTOM_VARIABLES;
    }
    if (!preferences) {
        preferences = {} as Preferences;
    }
    // ORIGINAL JS BUG FIX: The original code has this same guard at line 381, but the
    // function reads `profile.min_bg` at line 143 — before the guard — so when profile
    // is truly undefined, it crashes with `TypeError: Cannot read properties of undefined
    // (reading 'min_bg')` and never reaches the guard. The guard only protected against
    // `profile.current_basal === undefined` (profile exists but incomplete). The TS version
    // moves the guard before any property access, so both cases return a graceful error.
    // In production, Swift always passes a valid profile, so this is purely defensive.
    if (profile === undefined || profile.current_basal === undefined) {
        return { reason: '', error: 'Error: could not get current basal rate' } as DetermineBasalResult;
    }

    // ─── Overrides & profile target ────────────────────────────────────────
    const overrideTarget = trioCustomVariables.overrideTarget;
    const profileTarget = resolveProfileTarget(
        profile.min_bg,
        overrideTarget,
        trioCustomVariables.useOverride,
        profile.temptargetSet,
    );
    const { overrideFactor, sensitivity, carbRatio } = resolveOverrides(profile, trioCustomVariables);

    // ─── Dynamic ISF ────────────────────────────────────────────────────────
    const systemTime = new Date(currentTime);
    const weightPercentage = Number(profile.weightPercentage);
    const { weightedAverage, average_total_data } = trioCustomVariables;

    let tdd = trioCustomVariables.currentTDD;
    let dynISFenabled = preferences.useNewFormula;
    const tddBefore = tdd;

    const dynResult = calculateDynamicISF(
        glucoseStatus,
        profile,
        preferences,
        autosensData,
        sensitivity,
        profileTarget,
        dynISFenabled,
        tdd,
        weightedAverage,
        average_total_data,
        weightPercentage,
        middleWare,
    );
    dynISFenabled = dynResult.dynISFenabled;
    tdd = dynResult.tdd;
    const { tddReason, newRatio, insulinFactor, adjustmentFactor, enableSigmoid, tdd24hTo14dRatio } = dynResult;

    // ─── CGM validation ─────────────────────────────────────────────────────
    const cgmValidation = validateCGMData(
        glucoseStatus,
        profile,
        systemTime,
        overrideFactor,
        currenttemp,
        trioCustomVariables.useOverride,
        trioCustomVariables.duration,
    );
    if ('earlyReturn' in cgmValidation) return cgmValidation.earlyReturn;
    const { bg, tick, minDelta, minAvgDelta, maxDelta, deliverAt, profileCurrentBasal } = cgmValidation;

    // ─── Sensitivity & targets ──────────────────────────────────────────────
    const sensTargets = configureSensitivityAndTargets(
        glucoseStatus,
        profile,
        autosensData,
        profileTarget,
        overrideTarget,
        bg,
        dynISFenabled,
        newRatio,
        tdd24hTo14dRatio,
        overrideFactor,
        profileCurrentBasal,
        tddBefore,
        weightedAverage,
        average_total_data,
        weightPercentage,
        sensitivity,
        carbRatio,
        cgmValidation.basal,
        cgmValidation.reason,
    );
    if ('earlyReturn' in sensTargets) return sensTargets.earlyReturn;
    const { maxIOB, targetBG, minBG, maxBG, highBG, sensitivityRatio, adjustedSens, isfreason, targetLog } = sensTargets;
    let basal = sensTargets.basal;
    let threshold = sensTargets.threshold;

    // ─── IOB validation ─────────────────────────────────────────────────────
    let result = { reason: cgmValidation.reason ?? '' } as DetermineBasalResult;

    const iobValidation = validateIOBAndTemps(
        iobData,
        currenttemp,
        profile,
        systemTime,
        microBolusAllowed,
        tempBasalFunctions,
        result,
        deliverAt,
    );
    if ('earlyReturn' in iobValidation) return iobValidation.earlyReturn;
    const iobDatum = iobValidation.iobData;
    const iobArray = iobValidation.iobArray;

    // ─── BG impact & deviation ──────────────────────────────────────────────
    // The amount BG "should" be rising or falling based on insulin activity alone
    const bgImpact = round(-iobDatum.activity * adjustedSens * PRED_INTERVAL_MINUTES, 2);

    const deviationResult = projectEventualBG(
        bg,
        iobDatum,
        adjustedSens,
        sensitivity,
        minDelta,
        minAvgDelta,
        glucoseStatus.long_avgdelta,
        bgImpact,
    );
    const { deviation, naiveEventualBG } = deviationResult;
    let eventualBG = deviationResult.eventualBG;

    if (eventualBG === undefined || isNaN(eventualBG)) {
        result.error = `Error: could not calculate eventualBG. Sensitivity: ${adjustedSens} Deviation: ${deviation}`;
        return result;
    }
    const expectedDelta = calculateExpectedDelta(targetBG, eventualBG, bgImpact);

    // ─── Initialize result object ───────────────────────────────────────────
    result = {
        reason: cgmValidation.reason ?? '',
        temp: 'absolute',
        bg,
        tick,
        eventualBG,
        insulinReq: 0,
        reservoir: reservoirData,
        deliverAt,
        sensitivityRatio,
        CR: round(carbRatio, 1),
        current_target: targetBG,
        insulinForManualBolus: 0,
        manualBolusErrorString: 0,
        minDelta,
        expectedDelta,
        minGuardBG: undefined,
        minPredBG: undefined,
        threshold: convertBG(threshold, profile),
    } as DetermineBasalResult;

    // ─── SMB eligibility ────────────────────────────────────────────────────
    let enableSMB = false;
    if (trioCustomVariables.smbIsOff) {
        console.log("SMBs are always off.");
    } else {
        enableSMB = checkSMBEnabled(
            profile,
            microBolusAllowed,
            mealData,
            bg,
            targetBG,
            highBG,
            trioCustomVariables,
            systemTime,
        );
    }

    // ─── Carb absorption ────────────────────────────────────────────────────
    const carbAbsorption = calculateCarbAbsorption(
        minDelta,
        bgImpact,
        adjustedSens,
        carbRatio,
        sensitivity,
        sensitivityRatio,
        mealData,
        profile,
        systemTime,
    );
    const { carbImpact, carbImpactDuration, uamCarbImpact, carbSensFactor, remainingCATime, remainingCIpeak, slopeFromDeviations } = carbAbsorption;

    // ─── BG predictions ─────────────────────────────────────────────────────
    const bgPred = generateBGPredictions(
        iobArray,
        eventualBG,
        bg,
        adjustedSens,
        carbImpact,
        carbImpactDuration,
        uamCarbImpact,
        remainingCATime,
        remainingCIpeak,
        slopeFromDeviations,
        dynISFenabled,
        enableSigmoid,
        tdd,
        adjustmentFactor,
        insulinFactor,
        profile.enableUAM,
        targetBG,
        threshold,
        mealData,
    );
    eventualBG = bgPred.eventualBG;
    result.eventualBG = eventualBG;
    result.predBGs = bgPred.predBGs;
    let minPredBG = bgPred.minPredBG;
    let minGuardBG = bgPred.minGuardBG;
    const { lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, minIOBPredBG, IOBpredBGs, COBpredBGs } = bgPred;

    return calculateDosingDecision({
        result, iobData: iobDatum, mealData, profile, glucoseStatus, currenttemp,
        tempBasalFunctions, systemTime, trioCustomVariables,
        bg, eventualBG, naiveEventualBG,
        threshold, targetBG, minBG, maxBG, maxIOB,
        basal, adjustedSens, carbRatio, overrideFactor,
        expectedDelta, minDelta, maxDelta, tick,
        bgImpact, deviation,
        carbImpact, remainingCIpeak, carbSensFactor,
        minPredBG, minGuardBG,
        lastIOBpredBG, lastCOBpredBG, lastUAMpredBG,
        minIOBPredBG, IOBpredBGs, COBpredBGs,
        enableSMB, microBolusAllowed,
        isfreason, targetLog, tddReason,
    });

}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves the effective profile target, applying override if active and no temp target is set. */
export function resolveProfileTarget(
    minBG: number,
    overrideTarget: number,
    useOverride: boolean,
    temptargetSet: boolean | undefined,
): number {
    if (overrideTarget != 0 && overrideTarget != OVERRIDE_TARGET_SENTINEL && useOverride && !temptargetSet) {
        return overrideTarget;
    }
    return minBG;
}

/** Resolves override factor, sensitivity, and carb ratio based on trioCustomVariables overrides. */
export function resolveOverrides(
    profile: Profile,
    trioCustomVariables: TrioCustomVariables,
): { overrideFactor: number; sensitivity: number; carbRatio: number } {
    if (!trioCustomVariables.useOverride) {
        return { overrideFactor: 1, sensitivity: profile.sens, carbRatio: profile.carb_ratio };
    }

    const overrideFactor = trioCustomVariables.overridePercentage / 100;
    let sensitivity = profile.sens;
    let carbRatio = profile.carb_ratio;

    if (trioCustomVariables.isfAndCr) {
        sensitivity /= overrideFactor;
        carbRatio /= overrideFactor;
    } else {
        if (trioCustomVariables.cr) { carbRatio /= overrideFactor; }
        if (trioCustomVariables.isf) { sensitivity /= overrideFactor; }
    }

    return { overrideFactor, sensitivity, carbRatio };
}
