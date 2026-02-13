import {
    MS_PER_MINUTE,
    TEMP_BASAL_DURATION_MINUTES,
} from '../constants';

import { round_basal } from '../utils/round-basal';

import type {
    GlucoseStatus,
    CurrentTemp,
    Profile,
    DetermineBasalResult,
} from '../types/index';

import {
    BG_ERROR_CEILING,
    XDRIP_ERROR_CODE,
    CGM_NOISE_LEVEL_MEDIUM,
    BG_UNCHANGED_FLOOR,
    MAX_BG_DATA_AGE_MINUTES,
    MAX_BG_FUTURE_MINUTES,
    RECENT_CAL_THRESHOLD,
    DELTA_UNCHANGED_THRESHOLD,
} from './constants';

import type { CGMValidationResult } from './types';

import { round, convert_bg } from './helpers';


export function validateCGMData(
    glucose_status: GlucoseStatus,
    profile: Profile,
    systemTime: Date,
    overrideFactor: number,
    currenttemp: CurrentTemp,
    useOverride: boolean,
    overrideDuration: number
): { earlyReturn: DetermineBasalResult } | CGMValidationResult {
    const result = {} as DetermineBasalResult;
    const deliverAt = new Date(systemTime);

    if (profile === undefined || profile.current_basal === undefined) {
        result.error ='Error: could not get current basal rate';
        return { earlyReturn: result };
    }
    const profile_current_basal = round_basal(profile.current_basal, profile) * overrideFactor;
    const basal = profile_current_basal;

    // Print Current Override factor, if any
    if (useOverride) {
        if (overrideDuration == 0) {
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Duration: " + "Enabled indefinitely");
        } else
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Expires in: " + overrideDuration + " min.");
    }

    const bgTime = new Date(glucose_status.date!);
    const minAgo = round( (systemTime.getTime() - bgTime.getTime()) / MS_PER_MINUTE ,1);

    const bg = glucose_status.glucose;
    const noise = glucose_status.noise;

// Prep various delta variables.
    let tick: number | string;

    if (glucose_status.delta > -0.5) {
        tick = "+" + round(glucose_status.delta,0);
    } else {
        tick = round(glucose_status.delta,0);
    }
    const minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta);
    const minAvgDelta = Math.min(glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    const maxDelta = Math.max(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);


// Cancel high temps (and replace with neutral) or shorten long zero temps for various error conditions

    // 38 is an xDrip error state that usually indicates sensor failure
    // all other BG values between 11 and 37 mg/dL reflect non-error-code BG values, so we should zero temp for those
// First, print out different explanations for each different error condition
    if (bg <= BG_ERROR_CEILING || bg === XDRIP_ERROR_CODE || noise! >= CGM_NOISE_LEVEL_MEDIUM) {  //Dexcom is in ??? mode or calibrating, or xDrip reports high noise
        result.reason = "CGM is calibrating, in ??? state, or noise is high";
    }
    if (bg > BG_UNCHANGED_FLOOR && glucose_status.delta == 0 && glucose_status.short_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucose_status.short_avgdelta < DELTA_UNCHANGED_THRESHOLD && glucose_status.long_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucose_status.long_avgdelta < DELTA_UNCHANGED_THRESHOLD) {
        if (glucose_status.device == "fakecgm") {
            console.error("CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile)+ ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta, profile) + " mg/dL ~45m change");
            console.error("Simulator mode detected (" + glucose_status.device + "): continuing anyway");
        }
    }

    if (minAgo > MAX_BG_DATA_AGE_MINUTES || minAgo < -MAX_BG_FUTURE_MINUTES) { // Dexcom data is too old, or way in the future
        result.reason = "If current system time " + systemTime + " is correct, then BG data is too old. The last BG data was read "+minAgo+"m ago at "+bgTime;

        // if BG is too old/noisy, or is completely unchanging, cancel any high temps and shorten any long zero temps
    } else if ( glucose_status.short_avgdelta === 0 && glucose_status.long_avgdelta === 0 ) {
        if ( glucose_status.last_cal && glucose_status.last_cal < RECENT_CAL_THRESHOLD ) {
            result.reason = "CGM was just calibrated";
        } else {
            result.reason = "CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile) + ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta,profile) + " mg/dL ~45m change";
        }
    }

    if (bg <= BG_ERROR_CEILING || bg === XDRIP_ERROR_CODE || noise! >= CGM_NOISE_LEVEL_MEDIUM || minAgo > MAX_BG_DATA_AGE_MINUTES || minAgo < -MAX_BG_FUTURE_MINUTES) {
        if (currenttemp.rate >= basal) { // high temp is running
            result.reason += ". Replacing high temp basal of "+currenttemp.rate+" with neutral temp of "+basal;
            result.deliverAt = deliverAt as unknown as string;
            result.temp = 'absolute';
            result.duration = TEMP_BASAL_DURATION_MINUTES;
            result.rate = basal;
            return { earlyReturn: result };
            // don't use setTempBasal(), as it has logic that allows <120% high temps to continue running
        } else if ( currenttemp.rate === 0 && currenttemp.duration > TEMP_BASAL_DURATION_MINUTES ) { //shorten long zero temps to 30m
            result.reason += ". Shortening " + currenttemp.duration + "m long zero temp to 30m. ";
            result.deliverAt = deliverAt as unknown as string;
            result.temp = 'absolute';
            result.duration = TEMP_BASAL_DURATION_MINUTES;
            result.rate = 0;
            return { earlyReturn: result };
            // don't use setTempBasal(), as it has logic that allows long zero temps to continue running
        } else { //do nothing.
            result.reason += ". Temp " + currenttemp.rate + " <= current basal " + basal + "U/hr; doing nothing. ";
            return { earlyReturn: result };
        }
    }

    return { bg, noise, tick, minDelta, minAvgDelta, maxDelta, minAgo, bgTime, deliverAt, profile_current_basal, basal, reason: result.reason };
}
