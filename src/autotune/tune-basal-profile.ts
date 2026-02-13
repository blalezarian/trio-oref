import type {
    AutotuneBasalProfileEntry,
    AutotuneGlucoseDatum,
    AutotunePumpProfile,
    AutotuneBounds,
} from './types';
import {
    AUTOTUNE_ADJUSTMENT_FRACTION,
    DEFAULT_AUTOSENS_MAX,
    DEFAULT_AUTOSENS_MIN,
    BASAL_SCALE_DEFAULT,
    HOURS_PER_DAY,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASAL_SCALE = BASAL_SCALE_DEFAULT;
const PRIOR_HOURS = 3;

/** Weight given to old (untuned) rate when smoothing untuned hours */
const SMOOTH_OLD_WEIGHT = 0.8;
/** Weight given to each neighboring adjusted-hour rate when smoothing */
const SMOOTH_NEIGHBOR_WEIGHT = 0.1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TuneBasalResult {
    basalProfile: AutotuneBasalProfileEntry[];
    bounds: AutotuneBounds;
}

type ProfileType = 'basal' | 'pump';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune the 24-hour basal profile by adjusting rates based on glucose deviations */
export function tuneBasalProfile(
    basalProfile: AutotuneBasalProfileEntry[],
    pumpBasalProfile: AutotuneBasalProfileEntry[],
    basalGlucose: AutotuneGlucoseDatum[],
    ISF: number,
    pumpProfile: AutotunePumpProfile,
): TuneBasalResult | undefined {
    const hourlyBasalProfile = convertToHourlyProfile(basalProfile, 'basal');
    if (!hourlyBasalProfile) { return undefined; }

    let hourlyPumpProfile: AutotuneBasalProfileEntry[] | undefined;
    if (pumpBasalProfile && pumpBasalProfile[0]) {
        hourlyPumpProfile = convertToHourlyProfile(pumpBasalProfile, 'pump');
        if (!hourlyPumpProfile) { return undefined; }
    }

    const newHourlyBasalProfile = hourlyBasalProfile.map(entry => ({ ...entry }));

    const hourlyDeviations = sumDeviationsByHour(basalGlucose);
    adjustBasalsByDeviations(newHourlyBasalProfile, hourlyDeviations, ISF);

    const bounds: AutotuneBounds = {
        autotuneMax: pumpProfile.autosens_max ?? DEFAULT_AUTOSENS_MAX,
        autotuneMin: pumpProfile.autosens_min ?? DEFAULT_AUTOSENS_MIN,
    };

    if (hourlyPumpProfile) {
        capBasalRates(newHourlyBasalProfile, hourlyPumpProfile, bounds);
    }

    smoothUntunedHours(hourlyBasalProfile, newHourlyBasalProfile);

    console.error(newHourlyBasalProfile);

    return {
        basalProfile: newHourlyBasalProfile,
        bounds,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a potentially-negative hour index into 0-23 range */
function wrapHour(hour: number): number {
    return hour < 0 ? hour + HOURS_PER_DAY : hour;
}

/**
 * Expand a possibly-sparse basal schedule into a 24-element hourly array.
 * Returns undefined if any relevant entry has rate === 0 (error in profile).
 *
 * For 'basal': rate===0 check applies only to entries matching the hour.
 * For 'pump': rate===0 check applies to ALL entries (matching original behavior).
 */
export function convertToHourlyProfile(
    profile: AutotuneBasalProfileEntry[],
    profileType: ProfileType,
): AutotuneBasalProfileEntry[] | undefined {
    const hourly: AutotuneBasalProfileEntry[] = [];

    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        for (let entryIdx = 0; entryIdx < profile.length; entryIdx++) {
            if (profileType === 'pump' && profile[entryIdx].rate === 0) {
                console.error(`ERROR: bad pumpBasalProfile`, profile[entryIdx]);
                return undefined;
            }
            if (profile[entryIdx].minutes <= hour * 60) {
                if (profileType === 'basal' && profile[entryIdx].rate === 0) {
                    console.error(`ERROR: bad basalProfile`, profile[entryIdx]);
                    return undefined;
                }
                hourly[hour] = { ...profile[entryIdx] };
            }
        }
        hourly[hour].i = hour;
        hourly[hour].minutes = hour * 60;
        hourly[hour].start = ("000" + hour).slice(-2) + ":00:00";
        hourly[hour].rate = Math.round(hourly[hour].rate * 1000) / 1000;
    }

    return hourly;
}

/** Parse hour-of-day from a glucose datum, trying date -> displayTime -> dateString */
export function parseHourFromDatum(datum: AutotuneGlucoseDatum): number {
    if (datum.date) {
        return new Date(datum.date as number).getHours();
    }
    if (datum.displayTime) {
        return new Date((datum.displayTime as string).replace('T', ' ')).getHours();
    }
    if (datum.dateString) {
        return new Date(datum.dateString as string).getHours();
    }
    console.error("Could not determine last BG time");
    // Original crashes here with BGTime!.getHours() on undefined -- preserve behavior
    return (undefined as unknown as Date).getHours();
}

/** Sum deviations per hour from basalGlucose data */
export function sumDeviationsByHour(
    basalGlucose: AutotuneGlucoseDatum[],
): number[] {
    const hourlyDeviations = new Array<number>(HOURS_PER_DAY).fill(0);

    for (const datum of basalGlucose) {
        const hour = parseHourFromDatum(datum);
        hourlyDeviations[hour] += parseFloat(datum.deviation);
    }

    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        hourlyDeviations[hour] = Math.round(hourlyDeviations[hour] * 1000) / 1000;
    }

    return hourlyDeviations;
}

/** Adjust basal rates based on deviations -- spreads adjustment across prior 3 hours */
export function adjustBasalsByDeviations(
    newProfile: AutotuneBasalProfileEntry[],
    hourlyDeviations: number[],
    ISF: number,
): void {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        const deviations = hourlyDeviations[hour];
        console.error(`Hour ${hour} total deviations: ${deviations} mg/dL`);

        const basalNeeded = Math.round(AUTOTUNE_ADJUSTMENT_FRACTION * deviations / ISF * 100) / 100;
        console.error(`Hour ${hour} basal adjustment needed: ${basalNeeded} U/hr`);

        if (basalNeeded > 0) {
            for (let offset = -PRIOR_HOURS; offset < 0; offset++) {
                const targetHour = wrapHour(hour + offset);
                newProfile[targetHour].rate += basalNeeded / PRIOR_HOURS;
                newProfile[targetHour].rate = Math.round(newProfile[targetHour].rate * 1000) / 1000;
            }
        } else if (basalNeeded < 0) {
            let threeHourBasal = 0;
            for (let offset = -PRIOR_HOURS; offset < 0; offset++) {
                threeHourBasal += newProfile[wrapHour(hour + offset)].rate;
            }
            const adjustmentRatio = 1.0 + basalNeeded / threeHourBasal;
            for (let offset = -PRIOR_HOURS; offset < 0; offset++) {
                const targetHour = wrapHour(hour + offset);
                newProfile[targetHour].rate = newProfile[targetHour].rate * adjustmentRatio;
                newProfile[targetHour].rate = Math.round(newProfile[targetHour].rate * 1000) / 1000;
            }
        }
    }
}

/** Cap basal rates to autosens bounds relative to pump profile */
export function capBasalRates(
    newProfile: AutotuneBasalProfileEntry[],
    hourlyPumpProfile: AutotuneBasalProfileEntry[],
    bounds: AutotuneBounds,
): void {
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        const maxRate = hourlyPumpProfile[hour].rate * bounds.autotuneMax;
        const minRate = hourlyPumpProfile[hour].rate * bounds.autotuneMin;

        if (newProfile[hour].rate > maxRate) {
            console.error(`Limiting hour ${hour} basal to ${maxRate.toFixed(2)} (which is ${bounds.autotuneMax} * pump basal of ${hourlyPumpProfile[hour].rate})`);
            newProfile[hour].rate = maxRate;
        } else if (newProfile[hour].rate < minRate) {
            console.error(`Limiting hour ${hour} basal to ${minRate.toFixed(2)} (which is ${bounds.autotuneMin} * pump basal of ${hourlyPumpProfile[hour].rate})`);
            newProfile[hour].rate = minRate;
        }

        newProfile[hour].rate = Math.round(newProfile[hour].rate * BASAL_SCALE) / BASAL_SCALE;
    }
}

/** For hours with no adjustment, blend 80% old + 10% from nearest adjusted neighbors */
export function smoothUntunedHours(
    oldProfile: AutotuneBasalProfileEntry[],
    newProfile: AutotuneBasalProfileEntry[],
): void {
    let lastAdjustedHour = 0;

    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        if (oldProfile[hour].rate === newProfile[hour].rate) {
            let nextAdjustedHour = HOURS_PER_DAY - 1;
            for (let searchHour = hour; searchHour < HOURS_PER_DAY; searchHour++) {
                if (oldProfile[searchHour].rate !== newProfile[searchHour].rate) {
                    nextAdjustedHour = searchHour;
                    break;
                }
            }

            newProfile[hour].rate = Math.round(
                (SMOOTH_OLD_WEIGHT * oldProfile[hour].rate +
                 SMOOTH_NEIGHBOR_WEIGHT * newProfile[lastAdjustedHour].rate +
                 SMOOTH_NEIGHBOR_WEIGHT * newProfile[nextAdjustedHour].rate) * BASAL_SCALE,
            ) / BASAL_SCALE;

            if (newProfile[hour].untuned) {
                (newProfile[hour].untuned as number)++;
            } else {
                newProfile[hour].untuned = 1;
            }

            console.error(`Adjusting hour ${hour} basal from ${oldProfile[hour].rate} to ${newProfile[hour].rate} based on hour ${lastAdjustedHour} = ${newProfile[lastAdjustedHour].rate} and hour ${nextAdjustedHour} = ${newProfile[nextAdjustedHour].rate}`);
        } else {
            lastAdjustedHour = hour;
        }
    }
}
