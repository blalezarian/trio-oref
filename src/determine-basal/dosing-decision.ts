import {
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    PRED_INTERVAL_MINUTES,
    TEMP_BASAL_DURATION_MINUTES,
    MAX_TEMP_BASAL_DURATION_MINUTES,
    DEFAULT_SMB_DELIVERY_RATIO,
    DEFAULT_SMB_INTERVAL_MINUTES,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
} from '../shared/constants';

import { round_basal } from '../utils/round-basal';

import type {
    DetermineBasalResult,
} from '../types/index';

import {
    TEMP_ACTIVE_DURATION_MINUTES,
    TEMP_SHORT_DURATION_MINUTES,
    RATE_TOLERANCE_LOW,
    BASAL_SHORTFALL_FRACTION,
    INSULIN_OVERSHOOT_FACTOR,
    LOW_BG_SAFETY_THRESHOLD,
    IOB_NEG_CHECK_MINUTES,
    LOW_TEMP_CORRECTION_FACTOR,
    PRED_HORIZON_MAX_MINUTES,
    MINUTES_ABOVE_MIN_BG_THRESHOLD,
    CARBS_REQ_WINDOW_MINUTES,
    COB_DISCOUNT_FRACTION,
    MIN_SMB_INTERVAL_MINUTES,
    MAX_SMB_INTERVAL_MINUTES,
    DEFAULT_MAX_DELTA_BG_THRESHOLD,
    MAX_DELTA_BG_THRESHOLD_CAP,
    SMB_MAX_ZERO_TEMP_MINUTES,
    TOP_OF_HOUR_WINDOW_MINUTES,
    DELTA_SIGNIFICANCE_THRESHOLD,
    SECONDS_PER_MINUTE,
    BOLUS_ERR_GUARD_BELOW_THRESHOLD,
    BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD,
    BOLUS_ERR_RISING_SLOWER,
    BOLUS_ERR_FALLING_OR_MIXED,
    BOLUS_ERR_OTHER_DELTA,
    BOLUS_ERR_MIN_PRED_BELOW_MIN,
} from './constants';

import type { DosingDecisionInputs } from './types';

import { round, convert_bg } from './helpers';


export function calculateDosingDecision(inputs: DosingDecisionInputs): DetermineBasalResult {
    const {
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
        microBolusAllowed,
        isfreason, targetLog, tddReason,
    } = inputs;
    let enableSMB = inputs.enableSMB;
    const { advancedSettings, smbMinutes, uamMinutes } = trio_custom_variables;
    let insulinForManualBolus = 0;

    result.COB=meal_data.mealCOB;
    result.IOB=iob_data.iob;
    result.BGI=convert_bg(bgImpact,profile);
    result.deviation=convert_bg(deviation, profile);
    result.ISF=convert_bg(adjustedSens, profile);
    result.CR=round(carbRatio, 1);
    result.target_bg=convert_bg(target_bg, profile);
    result.current_target=round(target_bg, 0);
    result.reason = isfreason + ", COB: " + result.COB + ", Dev: " + result.deviation + ", BGI: " + result.BGI + ", CR: " + result.CR + ", Target: " + targetLog + ", minPredBG " + convert_bg(minPredBG, profile) + ", minGuardBG " + convert_bg(minGuardBG, profile) + ", IOBpredBG " + convert_bg(lastIOBpredBG, profile);
    if (lastCOBpredBG > 0) {
        result.reason += ", COBpredBG " + convert_bg(lastCOBpredBG, profile);
    }
    if (lastUAMpredBG > 0) {
        result.reason += ", UAMpredBG " + convert_bg(lastUAMpredBG, profile);
    }
    result.reason += tddReason;

    result.reason += "; "; // reason.conclusion started
// Use minGuardBG to prevent overdosing in hypo-risk situations
    // use naive_eventualBG if above 40, but switch to minGuardBG if both eventualBGs hit floor of 39
    let carbsReqBG = naive_eventualBG;
    if ( carbsReqBG < LOW_BG_SAFETY_THRESHOLD ) {
        carbsReqBG = Math.min( minGuardBG, carbsReqBG );
    }
    let bgUndershoot = threshold - carbsReqBG;
    // calculate how long until COB (or IOB) predBGs drop below min_bg
    let minutesAboveMinBG = PRED_HORIZON_MAX_MINUTES;
    let minutesAboveThreshold = PRED_HORIZON_MAX_MINUTES;
    if (meal_data.mealCOB > 0 && ( carbImpact > 0 || remainingCIpeak > 0 )) {
        for (let i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
        for (let i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < threshold ) {
                minutesAboveThreshold = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
    }

    else {
        for (let i=0; i<IOBpredBGs.length; i++) {
            if ( IOBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
        for (let i=0; i<IOBpredBGs.length; i++) {
            if ( IOBpredBGs[i] < threshold ) {
                minutesAboveThreshold = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
    }

    if (enableSMB && minGuardBG < threshold) {
        console.error("minGuardBG " + convert_bg(minGuardBG, profile) + " projected below " + convert_bg(threshold, profile) + " - disabling SMB");
        result.manualBolusErrorString = BOLUS_ERR_GUARD_BELOW_THRESHOLD;
        result.minGuardBG = minGuardBG;
        result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);

        enableSMB = false;
    }
// Disable SMB for sudden rises (often caused by calibrations or activation/deactivation of Dexcom's noise-filtering algorithm)
// Added maxDelta_bg_threshold as a hidden preference and included a cap at 0.4 as a safety limitLog
    const maxDelta_bg_threshold = profile.maxDelta_bg_threshold !== undefined
        ? Math.min(profile.maxDelta_bg_threshold, MAX_DELTA_BG_THRESHOLD_CAP)
        : DEFAULT_MAX_DELTA_BG_THRESHOLD;
    if ( maxDelta > maxDelta_bg_threshold * bg ) {
        console.error("maxDelta " + convert_bg(maxDelta, profile)+ " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - disabling SMB");
        result.reason += "maxDelta " + convert_bg(maxDelta, profile) + " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - SMB disabled!, ";
        enableSMB = false;
    }

// Calculate carbsReq (carbs required to avoid a hypo)
    console.error("BG projected to remain above " + convert_bg(min_bg, profile) + " for " + minutesAboveMinBG + "minutes");
    if ( minutesAboveThreshold < PRED_HORIZON_MAX_MINUTES || minutesAboveMinBG < MINUTES_ABOVE_MIN_BG_THRESHOLD ) {
        console.error("BG projected to remain above " + convert_bg(threshold,profile) + " for " + minutesAboveThreshold + "minutes");
    }
    // include at least minutesAboveThreshold worth of zero temps in calculating carbsReq
    // always include at least 30m worth of zero temp (carbs to 80, low temp up to target)
    const zeroTempDuration = minutesAboveThreshold;
    // BG undershoot, minus effect of zero temps until hitting min_bg, converted to grams, minus COB
    let zeroTempEffect = profile.current_basal*overrideFactor*adjustedSens*zeroTempDuration/MINUTES_PER_HOUR;
    // don't count the last 25% of COB against carbsReq
    const COBforCarbsReq = Math.max(0, meal_data.mealCOB - COB_DISCOUNT_FRACTION*meal_data.carbs);
    let carbsReq = (bgUndershoot - zeroTempEffect) / carbSensFactor - COBforCarbsReq;
    zeroTempEffect = round(zeroTempEffect);
    carbsReq = round(carbsReq);
    console.error("naive_eventualBG:",naive_eventualBG,"bgUndershoot:",bgUndershoot,"zeroTempDuration:",zeroTempDuration,"zeroTempEffect:",zeroTempEffect,"carbsReq:",carbsReq);
    if ( meal_data.reason == "Could not parse clock data" ) {
        console.error("carbsReq unknown: Could not parse clock data");
    } else if ( carbsReq >= profile.carbsReqThreshold! && minutesAboveThreshold <= CARBS_REQ_WINDOW_MINUTES ) {
        result.carbsReq = carbsReq;
        result.reason += carbsReq + " add'l carbs req w/in " + minutesAboveThreshold + "m; ";
    }

// Begin core dosing logic: check for situations requiring low or high temps, and return appropriate temp after first match

    // don't low glucose suspend if IOB is already super negative and BG is rising faster than predicted
    let worstCaseInsulinReq = 0;
    let durationReq = 0;
    if (bg < threshold && iob_data.iob < -profile.current_basal*overrideFactor*IOB_NEG_CHECK_MINUTES/MINUTES_PER_HOUR && minDelta > 0 && minDelta > expectedDelta) {
        result.reason += "IOB "+iob_data.iob+" < " + round(-profile.current_basal*overrideFactor*IOB_NEG_CHECK_MINUTES/MINUTES_PER_HOUR,2);
        result.reason += " and minDelta " + convert_bg(minDelta, profile) + " > " + "expectedDelta " + convert_bg(expectedDelta, profile) + "; ";
     // predictive low glucose suspend mode: BG is / is projected to be < threshold
    } else if ( bg < threshold || minGuardBG < threshold ) {
        result.reason += "minGuardBG " + convert_bg(minGuardBG, profile) + "<" + convert_bg(threshold, profile);
        bgUndershoot = target_bg - minGuardBG;

        if (minGuardBG < threshold) {
            result.manualBolusErrorString = BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD;
            result.minGuardBG = minGuardBG;
        }
        result.insulinForManualBolus =  round((eventualBG - target_bg) / adjustedSens, 2);

        worstCaseInsulinReq = bgUndershoot / adjustedSens;
        durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal*overrideFactor);
        durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
        // always set a 30-120m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
        durationReq = Math.min(MAX_TEMP_BASAL_DURATION_MINUTES,Math.max(TEMP_BASAL_DURATION_MINUTES,durationReq));
        return tempBasalFunctions.setTempBasal(0, durationReq, profile, result, currenttemp);
    }

    // if not in LGS mode, cancel temps before the top of the hour to reduce beeping/vibration
    if ( profile.skip_neutral_temps && (result.deliverAt as unknown as Date).getMinutes() >= TOP_OF_HOUR_WINDOW_MINUTES ) {
        if (!enableSMB) {
            result.reason += "; Canceling temp at " + (MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()) + "min before turn of the hour to avoid beeping of MDT. SMB are disabled anyways.";
            return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
        } else {
             console.error((MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()) + "min before turn of the hour, but SMB's are enabled - not skipping neutral temps.")
        }
    }

    let insulinReq = 0;
    let rate = basal;
    let insulinScheduled = 0;
    if (eventualBG < min_bg) { // if eventual BG is below target:
        result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " < " + convert_bg(min_bg, profile);
        // if 5m or 30m avg BG is rising faster than expected delta
        if ( minDelta > expectedDelta && minDelta > 0 && !carbsReq ) {
            // if naive_eventualBG < 40, set a 30m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
            if (naive_eventualBG < LOW_BG_SAFETY_THRESHOLD) {
                result.reason += ", naive_eventualBG < 40. ";
                return tempBasalFunctions.setTempBasal(0, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
            if (glucose_status.delta > minDelta) {
                result.reason += ", but Delta " + convert_bg(tick as number, profile) + " > expectedDelta " + convert_bg(expectedDelta, profile);
            } else {
                result.reason += ", but Min. Delta " + minDelta.toFixed(2) + " > Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }

        // calculate 30m low-temp required to get projected BG up to target
        // multiply by 2 to low-temp faster for increased hypo safety
        insulinReq = LOW_TEMP_CORRECTION_FACTOR * Math.min(0, (eventualBG - target_bg) / adjustedSens);
        insulinReq = round( insulinReq , 2);
        // calculate naiveInsulinReq based on naive_eventualBG
        let naiveInsulinReq = Math.min(0, (naive_eventualBG - target_bg) / adjustedSens);
        naiveInsulinReq = round( naiveInsulinReq , 2);
        if (minDelta < 0 && minDelta > expectedDelta) {
            // if we're barely falling, newinsulinReq should be barely negative
            const newinsulinReq = round(( insulinReq * (minDelta / expectedDelta) ), 2);
            insulinReq = newinsulinReq;
        }
        // rate required to deliver insulinReq less insulin over 30m:
        rate = basal + (LOW_TEMP_CORRECTION_FACTOR * insulinReq);
        rate = round_basal(rate, profile);

        // if required temp < existing temp basal
        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
        // if current temp would deliver a lot (30% of basal) less than the required insulin,
        // by both normal and naive calculations, then raise the rate
        const minInsulinReq = Math.min(insulinReq,naiveInsulinReq);

        console.log("naiveInsulinReq:" + naiveInsulinReq);

        if (insulinScheduled < minInsulinReq - basal*BASAL_SHORTFALL_FRACTION) {
            result.reason += ", " + currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " is a lot less than needed. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
        if (currenttemp.rate !== undefined && (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && rate >= currenttemp.rate * RATE_TOLERANCE_LOW)) {
            result.reason += ", temp " + currenttemp.rate + " ~< req " + rate + "U/hr. ";
            return result;
        }

        else {
            // calculate a long enough zero temp to eventually correct back up to target
            if ( rate <=0 ) {
                bgUndershoot = target_bg - naive_eventualBG;
                worstCaseInsulinReq = bgUndershoot / adjustedSens;
                durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal * overrideFactor);
                if (durationReq < 0) {
                    durationReq = 0;
                // don't set a temp longer than 120 minutes
                } else {
                    durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
                    durationReq = Math.min(MAX_TEMP_BASAL_DURATION_MINUTES,Math.max(0,durationReq));
                }
                if (durationReq > 0) {
                    result.reason += ", setting " + durationReq + "m zero temp. ";
                    return tempBasalFunctions.setTempBasal(rate, durationReq, profile, result, currenttemp);
                }
            }

            else {
                result.reason += ", setting " + rate + "U/hr. ";
            }
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
    }

    // if eventual BG is above min_bg but BG is falling faster than expected Delta
    if (minDelta < expectedDelta) {

        result.minDelta = minDelta;
        result.expectedDelta = expectedDelta;

        //Describe how the glucose is changing
        if (expectedDelta - minDelta >= DELTA_SIGNIFICANCE_THRESHOLD || (expectedDelta + (-1 * minDelta) >= DELTA_SIGNIFICANCE_THRESHOLD)) {
            if (minDelta >= 0 && expectedDelta > 0) {
                result.manualBolusErrorString = BOLUS_ERR_RISING_SLOWER;
            }
            else if ((minDelta < 0 && expectedDelta <= 0) ||  (minDelta < 0 && expectedDelta >= 0)) {
                result.manualBolusErrorString = BOLUS_ERR_FALLING_OR_MIXED;
            }
            else {
                result.manualBolusErrorString = BOLUS_ERR_OTHER_DELTA;
            }
        }

        result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);

        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB)) {
            if (glucose_status.delta < minDelta) {
                result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Delta " + convert_bg(tick as number, profile) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            } else {
                result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Min. Delta " + minDelta.toFixed(2) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }
    }
    // eventualBG or minPredBG is below max_bg
    if (Math.min(eventualBG,minPredBG) < max_bg) {
        if (minPredBG < min_bg && eventualBG > min_bg) {
            result.manualBolusErrorString = BOLUS_ERR_MIN_PRED_BELOW_MIN;
            result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);
        }

        // Moving this out of the if condition in L1429, so that minPredBG is becomes always available in result object (aka Trio's determination)
        result.minPredBG = minPredBG;

        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB )) {
            result.reason += convert_bg(eventualBG, profile)+ "-" + convert_bg(minPredBG, profile) + " in range: no temp required";
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }
    }

    // eventual BG is at/above target
    // if iob is over max, just cancel any temps
    if ( eventualBG >= max_bg ) {
        result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " >= " +  convert_bg(max_bg, profile) + ", ";
        if (eventualBG > max_bg) {
        result.insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
        }
    }
    if (iob_data.iob > max_iob) {
        result.reason += "IOB " + round(iob_data.iob,2) + " > max_iob " + max_iob;
        if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
            result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
            return result;
        } else {
            result.reason += "; setting current basal of " + basal + " as temp. ";
            return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
    }

    else { // otherwise, calculate 30m high-temp required to get projected BG down to target
        // insulinReq is the additional insulin required to get minPredBG down to target_bg
        insulinReq = round( (Math.min(minPredBG,eventualBG) - target_bg) / adjustedSens, 2);
        insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
        // if that would put us over max_iob, then reduce accordingly
        if (insulinReq > max_iob-iob_data.iob) {
            console.error(`SMB limited by maxIOB: ${max_iob - iob_data.iob} (. insulinReq: ${insulinReq} U)`);
            result.reason += "max_iob " + max_iob + ", ";
            insulinReq = max_iob-iob_data.iob;
        } else { console.error("SMB not limited by maxIOB ( insulinReq: " + insulinReq + " U).");}

        if (insulinForManualBolus > max_iob-iob_data.iob) {
            console.error(`Ev. Bolus limited by maxIOB: ${max_iob - iob_data.iob} (. insulinForManualBolus: ${insulinForManualBolus} U)`);
            result.reason += "max_iob " + max_iob + ", ";
        } else { console.error("Ev. Bolus would not be limited by maxIOB ( insulinForManualBolus: " + insulinForManualBolus + " U).");}

        // rate required to deliver insulinReq more insulin over 30m:
        rate = basal + (LOW_TEMP_CORRECTION_FACTOR * insulinReq);
        rate = round_basal(rate, profile);
        insulinReq = round(insulinReq,3);
        result.insulinReq = insulinReq;
        // minutes since last bolus
        const lastBolusAge = round(( new Date(systemTime).getTime() - iob_data.lastBolusTime! ) / MS_PER_MINUTE,1);

        // only allow microboluses with COB or low temp targets, or within DIA hours of a bolus
        if (microBolusAllowed && enableSMB && bg > threshold) {
            // never bolus more than maxSMBBasalMinutes worth of basal


            let smbMinutesSetting =  DEFAULT_MAX_SMB_BASAL_MINUTES;
            if (profile.maxSMBBasalMinutes !== undefined) {
                smbMinutesSetting = profile.maxSMBBasalMinutes;
            }
            let uamMinutesSetting = DEFAULT_MAX_SMB_BASAL_MINUTES;
            if (profile.maxUAMSMBBasalMinutes !== undefined) {
                uamMinutesSetting = profile.maxUAMSMBBasalMinutes;
            }

            if (trio_custom_variables.useOverride && advancedSettings && smbMinutes !== smbMinutesSetting) {
                console.error("SMB Max Minutes - setting overriden from " + smbMinutesSetting + " to " + smbMinutes);
                smbMinutesSetting = smbMinutes;
            }
            if (trio_custom_variables.useOverride && advancedSettings && uamMinutes !== uamMinutesSetting) {
                console.error("UAM Max Minutes - setting overriden from " + uamMinutesSetting + " to " + uamMinutes);
                uamMinutesSetting = uamMinutes;
            }

            const mealInsulinReq = round( meal_data.mealCOB / carbRatio ,3);
            let maxBolus = 0;
            if (smbMinutesSetting === undefined) {
                maxBolus = round(profile.current_basal *overrideFactor * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR ,1);
                console.error("smbMinutesSetting undefined: defaulting to 30m");

                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxBolus: " + maxBolus + " ( " + insulinReq + " U)");
                }
            } else if ( iob_data.iob > mealInsulinReq && iob_data.iob > 0 ) {
                console.error("IOB" + iob_data.iob + "> COB" + meal_data.mealCOB + "; mealInsulinReq =" + mealInsulinReq);
                if (uamMinutesSetting) {
                    console.error("maxUAMSMBBasalMinutes: " + uamMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                    maxBolus = round(profile.current_basal * overrideFactor * uamMinutesSetting / MINUTES_PER_HOUR ,1);
                } else {
                    console.error("maxUAMSMBBasalMinutes undefined: defaulting to 30m");
                    maxBolus = round( profile.current_basal  * overrideFactor * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR ,1);
                }
                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxUAMSMBBasalMinutes [ " + uamMinutesSetting + "m ]: " + maxBolus + "U ( " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxUAMSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            } else {
                console.error(".maxSMBBasalMinutes: " + smbMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                maxBolus = round(profile.current_basal  * overrideFactor * smbMinutesSetting / MINUTES_PER_HOUR ,1);
                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxSMBBasalMinutes: " + smbMinutesSetting + "m ]: " + maxBolus + "U ( insulinReq: " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            }
            // bolus 1/2 the insulinReq, up to maxBolus, rounding down to nearest bolus increment
            const bolusIncrement = profile.bolus_increment!;
            const roundSMBTo = 1 / bolusIncrement;

            const smb_ratio = Math.min(profile.smb_delivery_ratio!, 1);

            if (smb_ratio != DEFAULT_SMB_DELIVERY_RATIO) {
                console.error("SMB Delivery Ratio changed from default 0.5 to " + round(smb_ratio,2))
            }
            let microBolus = Math.min(insulinReq*smb_ratio, maxBolus);

            microBolus = Math.floor(microBolus*roundSMBTo)/roundSMBTo;
            // calculate a long enough zero temp to eventually correct back up to target
            const smbTarget = target_bg;
            worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG)/2 ) / adjustedSens;
            durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal * overrideFactor);

            // if insulinReq > 0 but not enough for a microBolus, don't set an SMB zero temp
            if (insulinReq > 0 && microBolus < bolusIncrement) {
                durationReq = 0;
            }

            let smbLowTempReq = 0;
            if (durationReq <= 0) {
                durationReq = 0;
            // don't set an SMB zero temp longer than 60 minutes
            } else if (durationReq >= TEMP_BASAL_DURATION_MINUTES) {
                durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
                durationReq = Math.min(SMB_MAX_ZERO_TEMP_MINUTES,Math.max(0,durationReq));
            } else {
                // if SMB durationReq is less than 30m, set a nonzero low temp
                smbLowTempReq = round( basal * durationReq/TEMP_BASAL_DURATION_MINUTES ,2);
                durationReq = TEMP_BASAL_DURATION_MINUTES;
            }
            result.reason += " insulinReq " + insulinReq;
            if (microBolus >= maxBolus) {
                result.reason +=  "; maxBolus " + maxBolus;
            }
            if (durationReq > 0) {
                result.reason += "; setting " + durationReq + "m low temp of " + smbLowTempReq + "U/h";
            }
            result.reason += ". ";

            //allow SMBs every 3 minutes by default
            let SMBInterval = DEFAULT_SMB_INTERVAL_MINUTES;
            if (profile.SMBInterval) {
                // allow SMBIntervals between 1 and 10 minutes
                SMBInterval = Math.min(MAX_SMB_INTERVAL_MINUTES,Math.max(MIN_SMB_INTERVAL_MINUTES,profile.SMBInterval));
            }
            const nextBolusMins = round(SMBInterval-lastBolusAge,0);
            const nextBolusSeconds = round((SMBInterval - lastBolusAge) * SECONDS_PER_MINUTE, 0) % SECONDS_PER_MINUTE;
            console.error("naive_eventualBG " + naive_eventualBG + "," + durationReq + "m " + smbLowTempReq + "U/h temp needed; last bolus " + lastBolusAge +"m ago; maxBolus: " + maxBolus);

            if (lastBolusAge > SMBInterval) {
                if (microBolus > 0) {
                    result.units = microBolus;
                    result.reason += "Microbolusing " + microBolus + "U. ";
                }
            } else {
                result.reason += "Waiting " + nextBolusMins + "m " + nextBolusSeconds + "s to microbolus again. ";
            }
            // if no zero temp is required, don't return yet; allow later code to set a high temp
            if (durationReq > 0) {
                result.rate = smbLowTempReq;
                result.duration = durationReq;
                return result;
            }

        }

        const maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

        if (rate > maxSafeBasal) {
            result.reason += "adj. req. rate: " + rate + " to maxSafeBasal: " + round(maxSafeBasal,2) + ", ";
            rate = round_basal(maxSafeBasal, profile);
        }

        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
        if (insulinScheduled >= insulinReq * INSULIN_OVERSHOOT_FACTOR) { // if current temp would deliver >2x more than the required insulin, lower the rate
            result.reason += currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " > 2 * insulinReq. Setting temp basal of " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }

        if (currenttemp.duration === undefined || currenttemp.duration === 0) { // no temp is set
            result.reason += "no temp, setting " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }

        if (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && (round_basal(rate, profile) <= round_basal(currenttemp.rate, profile))) { // if required temp <~ existing temp basal
            result.reason += "temp " + currenttemp.rate + " >~ req " + rate + "U/hr. ";
            return result;
        }

        // required temp > existing temp basal
        result.reason += "temp " + currenttemp.rate + "<" + rate + "U/hr. ";
        return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
    }
}
