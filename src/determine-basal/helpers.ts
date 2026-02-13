import {
    MGDL_TO_MMOL,
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    PRED_INTERVAL_MINUTES,
    TEMP_BASAL_DURATION_MINUTES,
} from '../shared/constants';

import {
    EXPECTED_DELTA_HOURS,
    TEMP_AGE_STALE_MINUTES,
    TEMP_END_GAP_MINUTES,
} from './constants';

import type {
    Profile,
    IOBData,
    CurrentTemp,
    TempBasalFunctions,
    DetermineBasalResult,
} from '../types/index';

/** Rounds value to the given number of decimal places (default 0). */
export function round(value: number, digits?: number): number {
    if (! digits) { digits = 0; }
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

/**
 * Calculate expected BG delta: we expect BG to rise or fall at the rate of BGI,
 * adjusted by the rate at which BG would need to rise / fall to get eventualBG
 * to target over 2 hours.
 */
export function calculate_expected_delta(
    target_bg: number,
    eventual_bg: number,
    bgi: number,
): number {
    // (hours * mins_per_hour) / 5 = how many 5 minute periods in 2h = 24
    const five_min_blocks = (EXPECTED_DELTA_HOURS * MINUTES_PER_HOUR) / PRED_INTERVAL_MINUTES;
    const target_delta = target_bg - eventual_bg;
    return /* expectedDelta */ round(bgi + (target_delta / five_min_blocks), 1);
}

/** Converts a BG value from mg/dL to the profile's output units. */
export function convert_bg(value: number, profile: Profile): number {
    if (profile.out_units === "mmol/L") return round(value * MGDL_TO_MMOL, 1);

    return Math.round(value);
}

/**
 * Validates IOB data, extracts iobArray, and compares currenttemp to lastTemp as a safety check.
 * Returns early if IOB data is missing/undefined or if a stale temp needs cancellation.
 */
export function validateIOBAndTemps(
    iob_data: IOBData,
    currenttemp: CurrentTemp,
    profile: Profile,
    systemTime: Date,
    microBolusAllowed: boolean,
    tempBasalFunctions: TempBasalFunctions,
    result: DetermineBasalResult,
    deliverAt: Date,
): { earlyReturn: DetermineBasalResult } | { iob_data: IOBData; iobArray: IOBData[] } {
    if (iob_data === undefined) {
        result.error ='Error: iob_data undefined. ';
        return { earlyReturn: result };
    }

    const iobArray = iob_data as unknown as IOBData[];

    if (typeof((iob_data as unknown as IOBData[]).length) && (iob_data as unknown as IOBData[]).length > 1) {
        iob_data = iobArray[0];
    }

    if (iob_data.activity === undefined || iob_data.iob === undefined) {
        result.error ='Error: iob_data missing some property. ';
        return { earlyReturn: result };
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
    console.error(`currenttemp:${currenttemp.rate} lastTempAge:${lastTempAge}m, tempModulus:${tempModulus}m`);
    result.temp = 'absolute';
    result.deliverAt = deliverAt as unknown as string;
    if ( microBolusAllowed && currenttemp && iob_data.lastTemp && currenttemp.rate !== iob_data.lastTemp.rate && lastTempAge > TEMP_AGE_STALE_MINUTES && currenttemp.duration ) {
        result.reason = `Warning: currenttemp rate ${currenttemp.rate} != lastTemp rate ${iob_data.lastTemp.rate} from pumphistory; canceling temp`; // reason.conclusion started
        return { earlyReturn: tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp) };
    }
    if ( currenttemp && iob_data.lastTemp && currenttemp.duration > 0 ) {
        const lastTempEnded = lastTempAge - iob_data.lastTemp.duration;
        if ( lastTempEnded > TEMP_END_GAP_MINUTES && lastTempAge > TEMP_AGE_STALE_MINUTES ) {
            result.reason = `Warning: currenttemp running but lastTemp from pumphistory ended ${lastTempEnded}m ago; canceling temp`; // reason.conclusion started
            return { earlyReturn: tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp) };
        }
    }

    return { iob_data, iobArray };
}

/**
 * Projects 30m deviation using minDelta/minAvgDelta/long_avgdelta, then calculates
 * naive_eventualBG and eventualBG based on net IOB and sensitivity.
 */
export function calculateDeviation(
    bg: number,
    iob_data: IOBData,
    adjustedSens: number,
    sensitivity: number,
    minDelta: number,
    minAvgDelta: number,
    long_avgdelta: number,
    bgImpact: number,
): { deviation: number; naive_eventualBG: number; eventualBG: number } {
    // project deviations for 30 minutes
    let deviation = round( TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES * ( minDelta - bgImpact ) );
    // don't overreact to a big negative delta: use minAvgDelta if deviation is negative
    if (deviation < 0) {
        deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( minAvgDelta - bgImpact ) );
        // and if deviation is still negative, use long_avgdelta
        if (deviation < 0) {
            deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( long_avgdelta - bgImpact ) );
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
    const eventualBG = naive_eventualBG + deviation;

    return { deviation, naive_eventualBG, eventualBG };
}
