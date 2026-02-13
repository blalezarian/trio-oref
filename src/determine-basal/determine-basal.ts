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
    MS_PER_MINUTE,
    PRED_INTERVAL_MINUTES,
    TEMP_BASAL_DURATION_MINUTES,
} from '../constants';

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
} from '../types/index';

import {
    TEMP_AGE_STALE_MINUTES,
    TEMP_END_GAP_MINUTES,
    OVERRIDE_TARGET_SENTINEL,
    DEFAULT_TRIO_CUSTOM_VARIABLES,
} from './constants';

import { round, convert_bg, calculate_expected_delta } from './helpers';
import { enable_smb } from './smb-eligibility';
import { calculateDynamicISF } from './dynamic-isf';
import { validateCGMData } from './cgm-validation';
import { configureSensitivityAndTargets } from './sensitivity-targets';
import { calculateCarbAbsorption } from './carb-absorption';
import { generateBGPredictions } from './bg-predictions';
import { calculateDosingDecision } from './dosing-decision';


export function determine_basal(
    glucose_status: GlucoseStatus,
    currenttemp: CurrentTemp,
    iob_data: IOBData,
    profile: Profile,
    autosens_data: AutosensData,
    meal_data: MealData,
    tempBasalFunctions: TempBasalFunctions,
    microBolusAllowed: boolean,
    reservoir_data: number | undefined,
    currentTime: Date | string | undefined,
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
        return { error: 'Error: could not get current basal rate' } as unknown as DetermineBasalResult;
    }

    let profileTarget = profile.min_bg;
    const overrideTarget = trio_custom_variables.overrideTarget;
    if (overrideTarget != 0 && overrideTarget != OVERRIDE_TARGET_SENTINEL && trio_custom_variables.useOverride && !profile.temptargetSet) {
        profileTarget = overrideTarget;
    }
    const smbIsOff = trio_custom_variables.smbIsOff;
    const isfAndCr = trio_custom_variables.isfAndCr;
    const isf = trio_custom_variables.isf;
    const cr_ = trio_custom_variables.cr;
    // tdd past 24 hour
    let tdd = trio_custom_variables.currentTDD;

    let dynISFenabled = preferences.useNewFormula

    let insulinForManualBolus = 0;
    const manualBolusErrorString = 0;

    let systemTime = new Date();
    if (currentTime) {
        systemTime = new Date(currentTime);
    }



    const weightedAverage = trio_custom_variables.weightedAverage;
    let overrideFactor = 1;
    let sensitivity = profile.sens;
    let carbRatio = profile.carb_ratio;
    if (trio_custom_variables.useOverride) {
        overrideFactor = trio_custom_variables.overridePercentage / 100;
        if (isfAndCr) {
            sensitivity /= overrideFactor;
            carbRatio /= overrideFactor;
        } else {
            if (cr_) { carbRatio /= overrideFactor; }
            if (isf) { sensitivity /= overrideFactor; }
        }
    }
    const weightPercentage = profile.weightPercentage;
    const average_total_data = trio_custom_variables.average_total_data;

    const tdd_before = tdd;
    const dynResult = calculateDynamicISF(
        glucose_status, profile, preferences, autosens_data,
        sensitivity, profileTarget, dynISFenabled, tdd,
        weightedAverage, average_total_data, weightPercentage!, middleWare
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
        weightPercentage!, sensitivity, carbRatio, cgmValidation.basal, cgmValidation.reason
    );
    if ('earlyReturn' in sensTargets) return sensTargets.earlyReturn;
    const { max_iob, target_bg, min_bg, max_bg, high_bg, sensitivityRatio, adjustedSens, isfreason, targetLog } = sensTargets;
    let basal = sensTargets.basal;
    let threshold = sensTargets.threshold;

    let result = {} as DetermineBasalResult;
    if (cgmValidation.reason) {
        result.reason = cgmValidation.reason;
    }

    if (iob_data === undefined) {
        result.error ='Error: iob_data undefined. ';
        return result;
    }

    const iobArray = iob_data as unknown as IOBData[];

    if (typeof((iob_data as unknown as IOBData[]).length) && (iob_data as unknown as IOBData[]).length > 1) {
        iob_data = iobArray[0];
    }

    if (iob_data.activity === undefined || iob_data.iob === undefined) {
        result.error ='Error: iob_data missing some property. ';
        return result;
    }

// Compare currenttemp to iob_data.lastTemp and cancel temp if they don't match, as a safety check
// This should occur after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before returning (doing nothing) below if eventualBG is undefined.
    let lastTempAge;
    if (iob_data.lastTemp !== undefined) {
        lastTempAge = round(( new Date(systemTime).getTime() - iob_data.lastTemp.date ) / MS_PER_MINUTE); // in minutes
    } else {
        lastTempAge = 0;
    }
    const tempModulus = (lastTempAge + currenttemp.duration) % TEMP_BASAL_DURATION_MINUTES;
    console.error("currenttemp:" + currenttemp.rate + " lastTempAge:" + lastTempAge + "m, tempModulus:" + tempModulus + "m");
    result.temp = 'absolute';
    result.deliverAt = deliverAt as unknown as string;
    if ( microBolusAllowed && currenttemp && iob_data.lastTemp && currenttemp.rate !== iob_data.lastTemp.rate && lastTempAge > TEMP_AGE_STALE_MINUTES && currenttemp.duration ) {
        result.reason = "Warning: currenttemp rate " + currenttemp.rate + " != lastTemp rate " + iob_data.lastTemp.rate + " from pumphistory; canceling temp"; // reason.conclusion started
        return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
    }
    if ( currenttemp && iob_data.lastTemp && currenttemp.duration > 0 ) {
        const lastTempEnded = lastTempAge - iob_data.lastTemp.duration;
        if ( lastTempEnded > TEMP_END_GAP_MINUTES && lastTempAge > TEMP_AGE_STALE_MINUTES ) {
            result.reason = "Warning: currenttemp running but lastTemp from pumphistory ended " + lastTempEnded + "m ago; canceling temp"; // reason.conclusion started
            return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
        }
    }

// Calculate BGI, deviation, and eventualBG.
// This has to happen after we obtain iob_data

    //calculate BG impact: the amount BG "should" be rising or falling based on insulin activity alone
    const bgImpact = round(( -iob_data.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
    // project deviations for 30 minutes
    let deviation = round( TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES * ( minDelta - bgImpact ) );
    // don't overreact to a big negative delta: use minAvgDelta if deviation is negative
    if (deviation < 0) {
        deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( minAvgDelta - bgImpact ) );
        // and if deviation is still negative, use long_avgdelta
        if (deviation < 0) {
            deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( glucose_status.long_avgdelta - bgImpact ) );
        }
    }

    // calculate the naive (bolus calculator math) eventual BG based on net IOB and sensitivity
    let naive_eventualBG = bg;
    if (iob_data.iob > 0) {
        naive_eventualBG = round( bg - (iob_data.iob * adjustedSens) );
    } else { // if IOB is negative, be more conservative and use the lower of adjustedSens, profile.sens
        naive_eventualBG = round( bg - (iob_data.iob * Math.min(adjustedSens, sensitivity) ) );
    }
    // and adjust it for the deviation above
    let eventualBG = naive_eventualBG + deviation;

    if (eventualBG === undefined || isNaN(eventualBG)) {
        result.error ='Error: could not calculate eventualBG. Sensitivity: ' + adjustedSens + ' Deviation: ' + deviation;
        return result;
    }
    const expectedDelta = calculate_expected_delta(target_bg, eventualBG, bgImpact);



// Initialize result (requestedTemp) object. Has to be done after eventualBG is calculated.
    result = {
        'temp': 'absolute'
        , 'bg': bg
        , 'tick': tick
        , 'eventualBG': eventualBG
        , 'insulinReq': 0
        , 'reservoir' : reservoir_data // The expected reservoir volume at which to deliver the microbolus (the reservoir volume from right before the last pumphistory run)
        , 'deliverAt' : deliverAt as unknown as string // The time at which the microbolus should be delivered
        , 'sensitivityRatio' : sensitivityRatio
        , 'CR' : round(carbRatio, 1)
        , 'current_target': target_bg
        , 'insulinForManualBolus': insulinForManualBolus
        , 'manualBolusErrorString': manualBolusErrorString
        , 'minDelta':  minDelta
        , 'expectedDelta':  expectedDelta
        , 'minGuardBG':  undefined
        , 'minPredBG':  undefined
        , 'threshold': convert_bg(threshold, profile)
    } as unknown as DetermineBasalResult;

    let enableSMB = false;

    // If SMB is always off, don't bother checking if we should enable SMBs
    if (smbIsOff) {
        console.error("SMBs are always off.");
        enableSMB = false;
    } else {
        enableSMB = enable_smb(
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
        iobArray, eventualBG, naive_eventualBG, bg, adjustedSens,
        carbImpact, carbImpactDuration, uamCarbImpact,
        remainingCATime, remainingCIpeak, slopeFromDeviations,
        dynISFenabled, enable_sigmoid, tdd, adjustmentFactor, insulinFactor,
        enableUAM, target_bg, threshold, meal_data, profile
    );
    eventualBG = bgPred.eventualBG;
    result.eventualBG = eventualBG;
    result.predBGs = bgPred.predBGs;
    let minPredBG = bgPred.minPredBG;
    let minGuardBG = bgPred.minGuardBG;
    const { lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, minIOBPredBG, IOBpredBGs, COBpredBGs } = bgPred;

    return calculateDosingDecision({
        result, iob_data, meal_data, profile, glucose_status, currenttemp,
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
