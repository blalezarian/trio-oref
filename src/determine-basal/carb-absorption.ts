import {
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    PRED_INTERVAL_MINUTES,
    DEFAULT_MAX_CARB_ABSORPTION_RATE,
    DEFAULT_ASSUMED_CARB_ABSORPTION_RATE,
    DEFAULT_REMAINING_CA_TIME_MIN_HOURS,
    DEFAULT_REMAINING_CARBS_CAP,
} from '../shared/constants';

import type {
    Profile,
    MealData,
} from '../types/index';

import {
    CARB_TIME_EXTENSION_FACTOR,
    LINEAR_DECAY_FACTOR,
    SLOPE_DAMPENING_DIVISOR,
} from './constants';

import type { CarbAbsorptionResult } from './types';

import { round, convert_bg } from './helpers';

/** Calculates carb impact, absorption rate, and remaining carb time for BG prediction. */
export function calculateCarbAbsorption(
    minDelta: number,
    bgImpact: number,
    adjustedSens: number,
    carbRatio: number,
    sensitivity: number,
    sensitivityRatio: number,
    meal_data: MealData,
    profile: Profile,
    systemTime: Date
): CarbAbsorptionResult {
    // carb impact and duration are 0 unless changed below
    let carbImpact = 0;
    let carbImpactDuration = 0;
    // calculate current carb absorption rate, and how long to absorb all carbs
    // CI = current carb impact on BG in mg/dL/5m
    carbImpact = round((minDelta - bgImpact),1);
    const uamCarbImpact = round((minDelta - bgImpact),1);
    // ISF (mg/dL/U) / CR (g/U) = CSF (mg/dL/g)

    // use autosens-adjusted adjustedSens to counteract autosens meal insulin dosing adjustments so that
    // autotuned CR is still in effect even when basals and ISF are being adjusted by TT or autosens
    // this avoids overdosing insulin for large meals when low temp targets are active
    const carbSensFactor = adjustedSens / carbRatio;
    console.log(`profile.sens:${convert_bg(sensitivity, profile)}, sens:${convert_bg(adjustedSens, profile)}, CSF:${round(carbSensFactor, 1)}`);

    const maxCarbAbsorptionRate = DEFAULT_MAX_CARB_ABSORPTION_RATE; // g/h; maximum rate to assume carbs will absorb if no CI observed
    // limitLog Carb Impact to maxCarbAbsorptionRate * carbSensFactor in mg/dL per 5m
    const maxCI = round(maxCarbAbsorptionRate*carbSensFactor*PRED_INTERVAL_MINUTES/MINUTES_PER_HOUR,1);
    if (carbImpact > maxCI) {
        console.log(`Limiting carb impact from ${carbImpact} to ${maxCI}mg/dL/5m (${maxCarbAbsorptionRate}g/h)`);
        carbImpact = maxCI;
    }
    const remainingCATime = adjustRemainingCarbTime(sensitivityRatio, meal_data, systemTime);

    // calculate the number of carbs absorbed over remainingCATime hours at current CI
    // CI (mg/dL/5m) * (5m)/5 (m) * 60 (min/hr) * 4 (h) / 2 (linear decay factor) = total carb impact (mg/dL)
    const totalCI = Math.max(0, carbImpact / PRED_INTERVAL_MINUTES * MINUTES_PER_HOUR * remainingCATime / LINEAR_DECAY_FACTOR);
    // totalCI (mg/dL) / CSF (mg/dL/g) = total carbs absorbed (g)
    const totalCA = totalCI / carbSensFactor;
    const remainingCarbsCap = profile.remainingCarbsCap ? Math.min(DEFAULT_REMAINING_CARBS_CAP, profile.remainingCarbsCap) : DEFAULT_REMAINING_CARBS_CAP;
    const remainingCarbsFraction = profile.remainingCarbsFraction ? Math.min(1, profile.remainingCarbsFraction) : 1;
    const remainingCarbsIgnore = 1 - remainingCarbsFraction;
    let remainingCarbs = Math.max(0, meal_data.mealCOB - totalCA - meal_data.carbs*remainingCarbsIgnore);
    remainingCarbs = Math.min(remainingCarbsCap, remainingCarbs);
    // assume remainingCarbs will absorb in a /\ shaped bilinear curve
    // peaking at remainingCATime / 2 and ending at remainingCATime hours
    // area of the /\ triangle is the same as a remainingCIpeak-height rectangle out to remainingCATime/2
    // remainingCIpeak (mg/dL/5m) = remainingCarbs (g) * CSF (mg/dL/g) * 5 (m/5m) * 1h/60m / (remainingCATime/2) (h)
    const remainingCIpeak = remainingCarbs * carbSensFactor * PRED_INTERVAL_MINUTES / MINUTES_PER_HOUR / (remainingCATime/LINEAR_DECAY_FACTOR);
    // assume deviations will drop back down at least at 1/3 the rate they ramped up
    const slopeFromDeviations = calculateSlopeFromDeviations(meal_data);
    //5m data points = g * (1U/10g) * (40mg/dL/1U) / (mg/dL/5m)
    // duration (in 5m data points) = COB (g) * CSF (mg/dL/g) / carbImpact (mg/dL/5m)
    // limitLog carbImpactDuration to remainingCATime hours: the reset goes to remainingCI
    carbImpactDuration = calculateCarbImpactDuration(carbImpact, remainingCATime, meal_data.mealCOB, carbSensFactor);

    // duration (hours) = duration (5m) * 5 / 60 * 2 (to account for linear decay)
    console.log(`Carb Impact:${carbImpact}mg/dL per 5m; CI Duration:${round(carbImpactDuration * PRED_INTERVAL_MINUTES / MINUTES_PER_HOUR * LINEAR_DECAY_FACTOR, 1)}hours; remaining CI (${remainingCATime / LINEAR_DECAY_FACTOR}h peak):${round(remainingCIpeak, 1)}mg/dL per 5m`);

    return { carbImpact, carbImpactDuration, uamCarbImpact, carbSensFactor, remainingCATime, remainingCIpeak, slopeFromDeviations };
}

// ---------------------------------------------------------------------------
// calculateCarbAbsorption helpers
// ---------------------------------------------------------------------------

/** Calculates remaining carb absorption time, adjusted for sensitivity and meal timing. */
function adjustRemainingCarbTime(
    sensitivityRatio: number,
    meal_data: MealData,
    systemTime: Date,
): number {
    let remainingCATimeMin = DEFAULT_REMAINING_CA_TIME_MIN_HOURS;
    // adjust remainingCATime (instead of CR) for autosens if sensitivityRatio defined
    if (sensitivityRatio) {
        remainingCATimeMin = remainingCATimeMin / sensitivityRatio;
    }

    if (!meal_data.carbs) return remainingCATimeMin;

    // 20 g/h means that anything <= 60g will get a remainingCATimeMin, 80g will get 4h, and 120g 6h
    // when actual absorption ramps up it will take over from remainingCATime
    remainingCATimeMin = Math.max(remainingCATimeMin, meal_data.mealCOB / DEFAULT_ASSUMED_CARB_ABSORPTION_RATE);
    const lastCarbAge = round((systemTime.getTime() - (meal_data.lastCarbTime as number)) / MS_PER_MINUTE);
    const fractionCOBAbsorbed = (meal_data.carbs - meal_data.mealCOB) / meal_data.carbs;
    // if the lastCarbTime was 1h ago, increase remainingCATime by 1.5 hours
    const remainingCATime = round(remainingCATimeMin + CARB_TIME_EXTENSION_FACTOR * lastCarbAge / MINUTES_PER_HOUR, 1);
    console.log(`Last carbs ${lastCarbAge} minutes ago; remainingCATime:${remainingCATime}hours; ${round(fractionCOBAbsorbed * 100, 1)}% carbs absorbed`);
    return remainingCATime;
}

/** Computes the slope from deviations, dampened by the min deviation. */
function calculateSlopeFromDeviations(meal_data: MealData): number {
    // calculate peak deviation in last hour, and slope from that to current deviation
    const slopeFromMaxDeviation = round(meal_data.slopeFromMaxDeviation, 2);
    // calculate lowest deviation in last hour, and slope from that to current deviation
    const slopeFromMinDeviation = round(meal_data.slopeFromMinDeviation, 2);
    // assume deviations will drop back down at least at 1/3 the rate they ramped up
    return Math.min(slopeFromMaxDeviation, -slopeFromMinDeviation / SLOPE_DAMPENING_DIVISOR);
}

/** Calculates carb impact duration, avoiding divide-by-zero when carbImpact is 0. */
function calculateCarbImpactDuration(
    carbImpact: number,
    remainingCATime: number,
    mealCOB: number,
    carbSensFactor: number,
): number {
    if (carbImpact === 0) return 0;

    return Math.min(
        remainingCATime * MINUTES_PER_HOUR / PRED_INTERVAL_MINUTES / LINEAR_DECAY_FACTOR,
        Math.max(0, mealCOB * carbSensFactor / carbImpact)
    );
}
