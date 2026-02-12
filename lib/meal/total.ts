import tz from 'moment-timezone';
import calcMealCOB from '../determine-basal/cob';
import type { CarbTreatment, GlucoseEntry, PumpHistoryEvent } from '../types/index';
import { MS_PER_HOUR, DEFAULT_MAX_MEAL_ABSORPTION_HOURS } from '../constants';

/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;

interface RecentCarbsOpts {
  treatments: CarbTreatment[] | null;
  profile: Record<string, unknown>;
  pumphistory: PumpHistoryEvent[];
  glucose?: GlucoseEntry[];
  basalprofile: Array<Record<string, unknown>>;
}

interface COBInputs {
  glucose_data: GlucoseEntry[] | undefined;
  iob_inputs: {
    profile: Record<string, unknown>;
    history: PumpHistoryEvent[];
  };
  basalprofile: Array<Record<string, unknown>>;
  mealTime: number;
  ciTime?: number;
}

interface RecentCarbsResult {
  carbs: number;
  nsCarbs: number;
  bwCarbs: number;
  journalCarbs: number;
  mealCOB: number;
  currentDeviation: number;
  maxDeviation: number;
  minDeviation: number;
  slopeFromMaxDeviation: number;
  slopeFromMinDeviation: number;
  allDeviations: number[];
  lastCarbTime: number;
  bwFound: boolean;
}

function round(value: number, digits?: number): number {
    if (! digits) { digits = 0; }
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

function recentCarbs(opts: RecentCarbsOpts, time: Date): RecentCarbsResult | Record<string, never> {
    const treatments = opts.treatments;
    const profile_data = opts.profile;
    let glucose_data: GlucoseEntry[] | undefined;
    if (opts.glucose !== undefined) {
        glucose_data = opts.glucose;
    }
    let carbs = 0;
    let nsCarbs = 0;
    let bwCarbs = 0;
    let journalCarbs = 0;
    let bwFound = false;
    const mealCarbTime = time.getTime();
    let lastCarbTime = 0;
    if (!treatments) return {};

    //console.error(glucose_data);
    const iob_inputs = {
        profile: profile_data
    ,   history: opts.pumphistory
    };
    const COB_inputs: COBInputs = {
        glucose_data: glucose_data
    ,   iob_inputs: iob_inputs
    ,   basalprofile: opts.basalprofile
    ,   mealTime: mealCarbTime
    };
    let mealCOB = 0;

    // this sorts the treatments collection in order.
    treatments.sort((a: CarbTreatment, b: CarbTreatment) => {
        const aDate = new Date(tz(a.timestamp).toDate());
        const bDate = new Date(tz(b.timestamp).toDate());
        //console.error(aDate);
        return bDate.getTime() - aDate.getTime();
    });

    let carbsToRemove = 0;
    let nsCarbsToRemove = 0;
    let bwCarbsToRemove = 0;
    let journalCarbsToRemove = 0;
    let maxMealAbsorptionTime = DEFAULT_MAX_MEAL_ABSORPTION_HOURS;

    if (typeof(profile_data.maxMealAbsorptionTime) === 'number' && ! isNaN(profile_data.maxMealAbsorptionTime)) {
        maxMealAbsorptionTime = profile_data.maxMealAbsorptionTime;
    } else {
        console.error("Bad profile.maxMealAbsorptionTime:",profile_data.maxMealAbsorptionTime);
    }

    treatments.forEach((treatment: CarbTreatment) => {
        const now = time.getTime();
        // consider carbs from up to the meal preference maxMealAbsorptionTime hours ago in calculating COB
        const carbWindow = now - maxMealAbsorptionTime * MS_PER_HOUR;
        const treatmentDate = new Date(tz(treatment.timestamp).toDate());
        const treatmentTime = treatmentDate.getTime();
        if (treatmentTime > carbWindow && treatmentTime <= now) {
            if (treatment.carbs! >= 1) {
                if (treatment.nsCarbs! >= 1) {
                    nsCarbs += parseFloat(treatment.nsCarbs as unknown as string);
                } else if (treatment.bwCarbs! >= 1) {
                    bwCarbs += parseFloat(treatment.bwCarbs as unknown as string);
                    bwFound = true;
                } else if (treatment.journalCarbs! >= 1) {
                    journalCarbs += parseFloat(treatment.journalCarbs as unknown as string);
                } else {
                    console.error("Treatment carbs unclassified:",treatment);
                }
                //console.error(treatment.carbs, maxCarbs, treatmentDate);
                carbs += parseFloat(treatment.carbs as unknown as string);
                COB_inputs.mealTime = treatmentTime;
                lastCarbTime = Math.max(lastCarbTime,treatmentTime);
                const myCarbsAbsorbed = calcMealCOB(COB_inputs).carbsAbsorbed;
                const myMealCOB = Math.max(0, carbs - myCarbsAbsorbed);
                if (typeof(myMealCOB) === 'number' && ! isNaN(myMealCOB)) {
                    mealCOB = Math.max(mealCOB, myMealCOB);
                } else {
                    console.error("Bad myMealCOB:",myMealCOB, "mealCOB:",mealCOB, "carbs:",carbs,"myCarbsAbsorbed:",myCarbsAbsorbed);
                }
                if (myMealCOB < mealCOB) {
                    carbsToRemove += parseFloat(treatment.carbs as unknown as string);
                    if (treatment.nsCarbs! >= 1) {
                        nsCarbsToRemove += parseFloat(treatment.nsCarbs as unknown as string);
                    } else if (treatment.bwCarbs! >= 1) {
                        bwCarbsToRemove += parseFloat(treatment.bwCarbs as unknown as string);
                    } else if (treatment.journalCarbs! >= 1) {
                        journalCarbsToRemove += parseFloat(treatment.journalCarbs as unknown as string);
                    }
                } else {
                    carbsToRemove = 0;
                    nsCarbsToRemove = 0;
                    bwCarbsToRemove = 0;
                }
                //console.error(carbs, carbsToRemove);
                //console.error("COB:",mealCOB);
            }
        }
    });
    // only include carbs actually used in calculating COB
    carbs -= carbsToRemove;
    nsCarbs -= nsCarbsToRemove;
    bwCarbs -= bwCarbsToRemove;
    journalCarbs -= journalCarbsToRemove;

    // calculate the current deviation and steepest deviation downslope over the last hour
    COB_inputs.ciTime = time.getTime();
    // set mealTime to 6h ago for Deviation calculations
    COB_inputs.mealTime = time.getTime() - maxMealAbsorptionTime * MS_PER_HOUR;
    const c = calcMealCOB(COB_inputs);
    //console.error(c.currentDeviation, c.slopeFromMaxDeviation);

    // set a hard upper limit on COB to mitigate impact of erroneous or malicious carb entry
    if (typeof(profile_data.maxCOB) === 'number' && ! isNaN(profile_data.maxCOB)) {
        mealCOB = Math.min( profile_data.maxCOB, mealCOB );
        console.error("mealCOB: " + round(mealCOB,1) + " with maxCOB " + profile_data.maxCOB + "g and maxMealAbsorptionTime " + maxMealAbsorptionTime + "hrs.");
    } else {
        console.error("Bad profile.maxCOB:",profile_data.maxCOB);
    }

    // if currentDeviation is null or maxDeviation is 0, set mealCOB to 0 for zombie-carb safety
    if (c.currentDeviation === undefined || c.currentDeviation === null) {
        console.error("");
        console.error("Warning: setting mealCOB to 0 because currentDeviation is null/undefined");
        mealCOB = 0;
    }
    if (c.maxDeviation === undefined || c.maxDeviation === null) {
        console.error("");
        console.error("Warning: setting mealCOB to 0 because maxDeviation is 0 or undefined");
        mealCOB = 0;
    }

    return {
        carbs: Math.round( carbs * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   nsCarbs: Math.round( nsCarbs * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   bwCarbs: Math.round( bwCarbs * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   journalCarbs: Math.round( journalCarbs * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   mealCOB: Math.round( mealCOB )
    ,   currentDeviation: Math.round( c.currentDeviation * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
    ,   maxDeviation: Math.round( c.maxDeviation * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
    ,   minDeviation: Math.round( c.minDeviation * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
    ,   slopeFromMaxDeviation: Math.round( c.slopeFromMaxDeviation * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   slopeFromMinDeviation: Math.round( c.slopeFromMinDeviation * ROUND_SCALE_3DP ) / ROUND_SCALE_3DP
    ,   allDeviations: c.allDeviations
    ,   lastCarbTime: lastCarbTime
    ,   bwFound: bwFound
    };
}

export default recentCarbs;
