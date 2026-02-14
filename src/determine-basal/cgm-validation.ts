import {
    MS_PER_MINUTE,
    TEMP_BASAL_DURATION_MINUTES,
} from '../shared/constants';

import { roundBasal } from '../utils/rounding';

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

import { round, convertBG } from './helpers';

/** Validates CGM data and returns either an early-return basalResult (for error conditions) or validated CGM values. */
export function validateCGMData(
    glucoseStatus: GlucoseStatus,
    profile: Profile,
    systemTime: Date,
    overrideFactor: number,
    currenttemp: CurrentTemp,
    useOverride: boolean,
    overrideDuration: number
): { earlyReturn: DetermineBasalResult } | CGMValidationResult {
    const basalResult = {} as DetermineBasalResult;
    const deliverAt = new Date(systemTime);

    if (profile === undefined || profile.current_basal === undefined) {
        basalResult.error ='Error: could not get current basal rate';
        return { earlyReturn: basalResult };
    }
    const profileCurrentBasal = roundBasal(profile.current_basal, profile) * overrideFactor;
    const basal = profileCurrentBasal;

    logOverrideStatus(useOverride, overrideFactor, overrideDuration);

    const bgTime = new Date(Number(glucoseStatus.date));
    const minAgo = round( (systemTime.getTime() - bgTime.getTime()) / MS_PER_MINUTE ,1);

    const bg = glucoseStatus.glucose;
    const noise = glucoseStatus.noise;

    // Prep various delta variables.
    const tick = formatTick(glucoseStatus.delta);
    const minDelta = Math.min(glucoseStatus.delta, glucoseStatus.short_avgdelta);
    const minAvgDelta = Math.min(glucoseStatus.short_avgdelta, glucoseStatus.long_avgdelta);
    const maxDelta = Math.max(glucoseStatus.delta, glucoseStatus.short_avgdelta, glucoseStatus.long_avgdelta);

    // Classify CGM error conditions and set reason strings
    classifyCGMErrorReason(basalResult, glucoseStatus, profile, bg, noise, minAgo, systemTime, bgTime);

    // Handle error conditions: cancel high temps, shorten zero temps, or do nothing
    if (isCGMError(bg, noise, minAgo)) {
        return { earlyReturn: handleCGMError(basalResult, currenttemp, basal, deliverAt) };
    }

    return { bg, noise, tick, minDelta, minAvgDelta, maxDelta, minAgo, bgTime, deliverAt, profileCurrentBasal, basal, reason: basalResult.reason };
}

// ---------------------------------------------------------------------------
// validateCGMData helpers
// ---------------------------------------------------------------------------

/** Logs override status if an override is active. */
function logOverrideStatus(useOverride: boolean, overrideFactor: number, overrideDuration: number): void {
    if (!useOverride) return;
    if (overrideDuration == 0) {
        console.log(`Profile Override is active. Override ${round(overrideFactor * 100, 0)}%. Override Duration: Enabled indefinitely`);
    } else
        console.log(`Profile Override is active. Override ${round(overrideFactor * 100, 0)}%. Override Expires in: ${overrideDuration} min.`);
}

/** Formats the tick string from a delta value. */
function formatTick(delta: number): number | string {
    if (delta > -0.5) {
        return `+${round(delta, 0)}`;
    }
    return round(delta, 0);
}

/** Sets basalResult.reason for various CGM error/stale/unchanged conditions. */
function classifyCGMErrorReason(
    basalResult: DetermineBasalResult,
    glucoseStatus: GlucoseStatus,
    profile: Profile,
    bg: number,
    noise: number | undefined,
    minAgo: number,
    systemTime: Date,
    bgTime: Date,
): void {
    // 38 is an xDrip error state that usually indicates sensor failure
    // all other BG values between 11 and 37 mg/dL reflect non-error-code BG values, so we should zero temp for those
    if (bg <= BG_ERROR_CEILING || bg === XDRIP_ERROR_CODE || Number(noise) >= CGM_NOISE_LEVEL_MEDIUM) {
        basalResult.reason = "CGM is calibrating, in ??? state, or noise is high";
    }
    if (bg > BG_UNCHANGED_FLOOR && glucoseStatus.delta == 0 && glucoseStatus.short_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucoseStatus.short_avgdelta < DELTA_UNCHANGED_THRESHOLD && glucoseStatus.long_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucoseStatus.long_avgdelta < DELTA_UNCHANGED_THRESHOLD) {
        if (glucoseStatus.device == "fakecgm") {
            console.log(`CGM data is unchanged (${convertBG(bg, profile)}+${convertBG(glucoseStatus.delta, profile)}) for 5m w/ ${convertBG(glucoseStatus.short_avgdelta, profile)} mg/dL ~15m change & ${convertBG(glucoseStatus.long_avgdelta, profile)} mg/dL ~45m change`);
            console.log(`Simulator mode detected (${glucoseStatus.device}): continuing anyway`);
        }
    }

    if (minAgo > MAX_BG_DATA_AGE_MINUTES || minAgo < -MAX_BG_FUTURE_MINUTES) {
        basalResult.reason = `If current system time ${systemTime} is correct, then BG data is too old. The last BG data was read ${minAgo}m ago at ${bgTime}`;
    } else if ( glucoseStatus.short_avgdelta === 0 && glucoseStatus.long_avgdelta === 0 ) {
        if ( glucoseStatus.last_cal && glucoseStatus.last_cal < RECENT_CAL_THRESHOLD ) {
            basalResult.reason = "CGM was just calibrated";
        } else {
            basalResult.reason = `CGM data is unchanged (${convertBG(bg, profile)}+${convertBG(glucoseStatus.delta, profile)}) for 5m w/ ${convertBG(glucoseStatus.short_avgdelta, profile)} mg/dL ~15m change & ${convertBG(glucoseStatus.long_avgdelta, profile)} mg/dL ~45m change`;
        }
    }
}

/** Returns true if any CGM error condition is present. */
function isCGMError(bg: number, noise: number | undefined, minAgo: number): boolean {
    return bg <= BG_ERROR_CEILING
        || bg === XDRIP_ERROR_CODE
        || Number(noise) >= CGM_NOISE_LEVEL_MEDIUM
        || minAgo > MAX_BG_DATA_AGE_MINUTES
        || minAgo < -MAX_BG_FUTURE_MINUTES;
}

/** Decides how to handle a CGM error: replace high temp, shorten zero temp, or do nothing. */
function handleCGMError(
    basalResult: DetermineBasalResult,
    currenttemp: CurrentTemp,
    basal: number,
    deliverAt: Date,
): DetermineBasalResult {
    if (currenttemp.rate >= basal) { // high temp is running
        basalResult.reason += `. Replacing high temp basal of ${currenttemp.rate} with neutral temp of ${basal}`;
        basalResult.deliverAt = deliverAt;
        basalResult.temp = 'absolute';
        basalResult.duration = TEMP_BASAL_DURATION_MINUTES;
        basalResult.rate = basal;
        return basalResult;
    }

    if ( currenttemp.rate === 0 && currenttemp.duration > TEMP_BASAL_DURATION_MINUTES ) { //shorten long zero temps to 30m
        basalResult.reason += `. Shortening ${currenttemp.duration}m long zero temp to 30m. `;
        basalResult.deliverAt = deliverAt;
        basalResult.temp = 'absolute';
        basalResult.duration = TEMP_BASAL_DURATION_MINUTES;
        basalResult.rate = 0;
        return basalResult;
    }

    //do nothing.
    basalResult.reason += `. Temp ${currenttemp.rate} <= current basal ${basal}U/hr; doing nothing. `;
    return basalResult;
}
