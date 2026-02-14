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

// Define various functions used later on, in the main function determine_basal() below

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

import { round, convertBG, calculateExpectedDelta, validateIOBAndTemps, calculateDeviation } from './helpers';
import { enableSMB as checkSMBEnabled } from './smb-eligibility';
import { calculateDynamicISF } from './dynamic-isf';
import { validateCGMData } from './cgm-validation';
import { configureSensitivityAndTargets } from './sensitivity-targets';
import { calculateCarbAbsorption } from './carb-absorption';
import { generateBGPredictions } from './bg-predictions';
import { calculateDosingDecision } from './dosing-decision';

/** Main determine-basal entry point: calculates the recommended temp basal / SMB dosing action. */
export function determine_basal(
    glucose_status: GlucoseStatus,
    currenttemp: CurrentTemp,
    iob_data: IOBData[],
    profile: Profile,
    autosens_data: AutosensData,
    meal_data: MealData,
    tempBasalFunctions: TempBasalFunctions,
    microBolusAllowed: boolean,
    reservoir_data: number | undefined,
    currentTime: Date | ISODateString | undefined,
    _pumphistory: unknown[],
    preferences: Preferences,
    _basalprofile: BasalEntry[] | undefined,
    trio_custom_variables?: TrioCustomVariables,
    middleWare?: (arg: DetermineBasalResult) => DetermineBasalResult
): DetermineBasalResult {

    if (!trio_custom_variables) {
        trio_custom_variables = DEFAULT_TRIO_CUSTOM_VARIABLES;
    }
    if (!preferences) {
        preferences = {} as Preferences;
    }
    if (profile === undefined || profile.current_basal === undefined) {
        return { reason: '', error: 'Error: could not get current basal rate' } as DetermineBasalResult;
    }

    const overrideTarget = trio_custom_variables.overrideTarget;
    const profileTarget = resolveProfileTarget(profile.min_bg, overrideTarget, trio_custom_variables.useOverride, profile.temptargetSet);
    const { overrideFactor, sensitivity, carbRatio } = resolveOverrides(profile, trio_custom_variables);

    // tdd past 24 hour
    let tdd = trio_custom_variables.currentTDD;
    let dynISFenabled = preferences.useNewFormula;

    const insulinForManualBolus = 0;
    const manualBolusErrorString = 0;
    const systemTime = currentTime ? new Date(currentTime) : new Date();

    const weightPercentage = Number(profile.weightPercentage);
    const { weightedAverage, average_total_data } = trio_custom_variables;

    const tdd_before = tdd;
    const dynResult = calculateDynamicISF(
        glucose_status, profile, preferences, autosens_data,
        sensitivity, profileTarget, dynISFenabled, tdd,
        weightedAverage, average_total_data, weightPercentage, middleWare
    );
    dynISFenabled = dynResult.dynISFenabled;
    tdd = dynResult.tdd;
    const { tddReason, newRatio, insulinFactor, adjustmentFactor, enable_sigmoid, tdd24h_14d_Ratio } = dynResult;

    const cgmValidation = validateCGMData(
        glucose_status, profile, systemTime, overrideFactor,
        currenttemp, trio_custom_variables.useOverride, trio_custom_variables.duration
    );
    if ('earlyReturn' in cgmValidation) return cgmValidation.earlyReturn;
    const { bg, tick, minDelta, minAvgDelta, maxDelta, deliverAt, profile_current_basal } = cgmValidation;

    const sensTargets = configureSensitivityAndTargets(
        glucose_status, profile, autosens_data, profileTarget, overrideTarget,
        bg, dynISFenabled, newRatio, tdd24h_14d_Ratio, overrideFactor,
        profile_current_basal, tdd_before, weightedAverage, average_total_data,
        weightPercentage, sensitivity, carbRatio, cgmValidation.basal, cgmValidation.reason
    );
    if ('earlyReturn' in sensTargets) return sensTargets.earlyReturn;
    const { max_iob, target_bg, min_bg, max_bg, high_bg, sensitivityRatio, adjustedSens, isfreason, targetLog } = sensTargets;
    let basal = sensTargets.basal;
    let threshold = sensTargets.threshold;

    let result = {} as DetermineBasalResult;
    if (cgmValidation.reason) {
        result.reason = cgmValidation.reason;
    }

    const iobValidation = validateIOBAndTemps(iob_data, currenttemp, profile, systemTime, microBolusAllowed, tempBasalFunctions, result, deliverAt);
    if ('earlyReturn' in iobValidation) return iobValidation.earlyReturn;
    const iob_datum = iobValidation.iob_data;
    const iobArray = iobValidation.iobArray;

    //calculate BG impact: the amount BG "should" be rising or falling based on insulin activity alone
    const bgImpact = round(( -iob_datum.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);

    const deviationResult = calculateDeviation(bg, iob_datum, adjustedSens, sensitivity, minDelta, minAvgDelta, glucose_status.long_avgdelta, bgImpact);
    const { deviation, naive_eventualBG } = deviationResult;
    let eventualBG = deviationResult.eventualBG;

    if (eventualBG === undefined || isNaN(eventualBG)) {
        result.error = `Error: could not calculate eventualBG. Sensitivity: ${adjustedSens} Deviation: ${deviation}`;
        return result;
    }
    const expectedDelta = calculateExpectedDelta(target_bg, eventualBG, bgImpact);

    // Initialize result (requestedTemp) object. Has to be done after eventualBG is calculated.
    result = {
        reason: cgmValidation.reason ?? '',
        temp: 'absolute',
        bg,
        tick,
        eventualBG,
        insulinReq: 0,
        reservoir: reservoir_data,
        deliverAt,
        sensitivityRatio,
        CR: round(carbRatio, 1),
        current_target: target_bg,
        insulinForManualBolus,
        manualBolusErrorString,
        minDelta,
        expectedDelta,
        minGuardBG: undefined,
        minPredBG: undefined,
        threshold: convertBG(threshold, profile),
    } as DetermineBasalResult;

    let enableSMB = false;

    // If SMB is always off, don't bother checking if we should enable SMBs
    if (trio_custom_variables.smbIsOff) {
        console.log("SMBs are always off.");
    } else {
        enableSMB = checkSMBEnabled(
            profile,
            microBolusAllowed,
            meal_data,
            bg,
            target_bg,
            high_bg,
            trio_custom_variables,
            systemTime
        );
    }

    const enableUAM = (profile.enableUAM);

    const carbAbsorption = calculateCarbAbsorption(
        minDelta, bgImpact, adjustedSens, carbRatio, sensitivity,
        sensitivityRatio, meal_data, profile, systemTime
    );
    const { carbImpact, carbImpactDuration, uamCarbImpact, carbSensFactor, remainingCATime, remainingCIpeak, slopeFromDeviations } = carbAbsorption;

    const bgPred = generateBGPredictions(
        iobArray, eventualBG, bg, adjustedSens,
        carbImpact, carbImpactDuration, uamCarbImpact,
        remainingCATime, remainingCIpeak, slopeFromDeviations,
        dynISFenabled, enable_sigmoid, tdd, adjustmentFactor, insulinFactor,
        enableUAM, target_bg, threshold, meal_data
    );
    eventualBG = bgPred.eventualBG;
    result.eventualBG = eventualBG;
    result.predBGs = bgPred.predBGs;
    let minPredBG = bgPred.minPredBG;
    let minGuardBG = bgPred.minGuardBG;
    const { lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, minIOBPredBG, IOBpredBGs, COBpredBGs } = bgPred;

    return calculateDosingDecision({
        result, iob_data: iob_datum, meal_data, profile, glucose_status, currenttemp,
        tempBasalFunctions, systemTime, trio_custom_variables,
        bg, eventualBG, naive_eventualBG,
        threshold, target_bg, min_bg, max_bg, max_iob,
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

/** Resolves override factor, sensitivity, and carb ratio based on trio_custom_variables overrides. */
export function resolveOverrides(
    profile: Profile,
    trio_custom_variables: TrioCustomVariables,
): { overrideFactor: number; sensitivity: number; carbRatio: number } {
    if (!trio_custom_variables.useOverride) {
        return { overrideFactor: 1, sensitivity: profile.sens, carbRatio: profile.carb_ratio };
    }

    const overrideFactor = trio_custom_variables.overridePercentage / 100;
    let sensitivity = profile.sens;
    let carbRatio = profile.carb_ratio;

    if (trio_custom_variables.isfAndCr) {
        sensitivity /= overrideFactor;
        carbRatio /= overrideFactor;
    } else {
        if (trio_custom_variables.cr) { carbRatio /= overrideFactor; }
        if (trio_custom_variables.isf) { sensitivity /= overrideFactor; }
    }

    return { overrideFactor, sensitivity, carbRatio };
}
