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

import { round } from '../utils/rounding';

/**
 * Calculate expected BG delta: we expect BG to rise or fall at the rate of BGI,
 * adjusted by the rate at which BG would need to rise / fall to get eventualBG
 * to target over 2 hours.
 */
export function calculateExpectedDelta(
    targetBG: number,
    eventualBG: number,
    bgi: number,
): number {
    // (hours * mins_per_hour) / 5 = how many 5 minute periods in 2h = 24
    const fiveMinBlocks = (EXPECTED_DELTA_HOURS * MINUTES_PER_HOUR) / PRED_INTERVAL_MINUTES;
    const targetDelta = targetBG - eventualBG;
    return /* expectedDelta */ round(bgi + (targetDelta / fiveMinBlocks), 1);
}

/** Converts a BG value from mg/dL to the profile's output units. */
export function convertBG(value: number, profile: Profile): number {
    if (profile.out_units === "mmol/L") return round(value * MGDL_TO_MMOL, 1);

    return Math.round(value);
}

/**
 * Validates IOB data, extracts iobArray, and compares currenttemp to lastTemp as a safety check.
 * Returns early if IOB data is missing/undefined or if a stale temp needs cancellation.
 */
export function validateIOBAndTemps(
    iobData: IOBData[],
    currenttemp: CurrentTemp,
    profile: Profile,
    systemTime: Date,
    microBolusAllowed: boolean,
    tempBasalFunctions: TempBasalFunctions,
    result: DetermineBasalResult,
    deliverAt: Date,
): { earlyReturn: DetermineBasalResult } | { iobData: IOBData; iobArray: IOBData[] } {
    if (iobData === undefined) {
        result.error ='Error: iob_data undefined. ';
        return { earlyReturn: result };
    }

    const iobArray = iobData;
    const iob_datum = iobArray[0];

    if (iob_datum.activity === undefined || iob_datum.iob === undefined) {
        result.error ='Error: iob_data missing some property. ';
        return { earlyReturn: result };
    }

    // Compare currenttemp to iob_data.lastTemp and cancel temp if they don't match, as a safety check
    // This should occur after checking that we're not in one of the CGM-data-related error conditions,
    // and before returning (doing nothing) below if eventualBG is undefined.
    const lastTempAge = iob_datum.lastTemp !== undefined
        ? round((systemTime.getTime() - iob_datum.lastTemp.date) / MS_PER_MINUTE)
        : 0;
    const tempModulus = (lastTempAge + currenttemp.duration) % TEMP_BASAL_DURATION_MINUTES;
    console.log(`currenttemp:${currenttemp.rate} lastTempAge:${lastTempAge}m, tempModulus:${tempModulus}m`);
    result.temp = 'absolute';
    result.deliverAt = deliverAt;

    const staleTempResult = checkStaleTempBasal(
        currenttemp, iob_datum, lastTempAge,
        microBolusAllowed, tempBasalFunctions, profile, result,
    );
    if (staleTempResult) return { earlyReturn: staleTempResult };

    return { iobData: iob_datum, iobArray };
}

/**
 * Checks whether the current temp basal is stale or mismatched with pump history,
 * and cancels it if so. Returns the cancellation result, or null if no action needed.
 */
export function checkStaleTempBasal(
    currenttemp: CurrentTemp,
    iobDatum: IOBData,
    lastTempAge: number,
    microBolusAllowed: boolean,
    tempBasalFunctions: TempBasalFunctions,
    profile: Profile,
    result: DetermineBasalResult,
): DetermineBasalResult | null {
    // Cancel if currenttemp rate doesn't match lastTemp rate from pump history
    if (microBolusAllowed && currenttemp && iobDatum.lastTemp && currenttemp.rate !== iobDatum.lastTemp.rate && lastTempAge > TEMP_AGE_STALE_MINUTES && currenttemp.duration) {
        result.reason = `Warning: currenttemp rate ${currenttemp.rate} != lastTemp rate ${iobDatum.lastTemp.rate} from pumphistory; canceling temp`;
        return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
    }
    // Cancel if lastTemp from pump history ended too long ago
    if (currenttemp && iobDatum.lastTemp && currenttemp.duration > 0) {
        const lastTempEnded = lastTempAge - iobDatum.lastTemp.duration;
        if (lastTempEnded > TEMP_END_GAP_MINUTES && lastTempAge > TEMP_AGE_STALE_MINUTES) {
            result.reason = `Warning: currenttemp running but lastTemp from pumphistory ended ${lastTempEnded}m ago; canceling temp`;
            return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
        }
    }
    return null;
}

/**
 * Projects 30m deviation using minDelta/minAvgDelta/long_avgdelta, then calculates
 * naiveEventualBG and eventualBG based on net IOB and sensitivity.
 */
export function projectEventualBG(
    bg: number,
    iobData: IOBData,
    adjustedSens: number,
    sensitivity: number,
    minDelta: number,
    minAvgDelta: number,
    longAvgDelta: number,
    bgImpact: number,
): { deviation: number; naiveEventualBG: number; eventualBG: number } {
    // project deviations for 30 minutes
    let deviation = round( TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES * ( minDelta - bgImpact ) );
    // don't overreact to a big negative delta: use minAvgDelta if deviation is negative
    if (deviation < 0) {
        deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( minAvgDelta - bgImpact ) );
        // and if deviation is still negative, use longAvgDelta
        if (deviation < 0) {
            deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( longAvgDelta - bgImpact ) );
        }
    }

    // calculate the naive (bolus calculator math) eventual BG based on net IOB and sensitivity
    // if IOB is negative, be more conservative and use the lower of adjustedSens, profile.sens
    const naiveEventualBG = iobData.iob > 0
        ? round(bg - (iobData.iob * adjustedSens))
        : round(bg - (iobData.iob * Math.min(adjustedSens, sensitivity)));
    // and adjust it for the deviation above
    const eventualBG = naiveEventualBG + deviation;

    return { deviation, naiveEventualBG, eventualBG };
}
