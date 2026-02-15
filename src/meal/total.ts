import { detectCarbAbsorption as calcMealCOB } from '../cob/index';
import type { CarbTreatment, GlucoseEntry, PumpHistoryEvent, BasalProfileEntry } from '../types/index';
import type { IobProfile } from '../iob/types';
import { MS_PER_HOUR, DEFAULT_MAX_MEAL_ABSORPTION_HOURS } from '../shared/constants';
import { round, roundTo2dp, roundTo3dp } from '../utils/rounding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentCarbsOpts {
    treatments: CarbTreatment[] | null;
    profile: IobProfile;
    pumphistory: PumpHistoryEvent[];
    glucose?: GlucoseEntry[];
    basalprofile: BasalProfileEntry[];
}

interface COBInputs {
    glucose_data: GlucoseEntry[] | undefined;
    iob_inputs: {
        profile: IobProfile;
        history: PumpHistoryEvent[];
    };
    basalprofile: BasalProfileEntry[];
    mealTime: number;
    carbImpactTime?: number;
}

interface RecentCarbsResult {
    carbs: number;
    nsCarbs: number;
    bwCarbs: number;
    journalCarbs: number;
    mealCOB: number;
    currentDeviation: number | undefined;
    maxDeviation: number;
    minDeviation: number;
    slopeFromMaxDeviation: number;
    slopeFromMinDeviation: number;
    allDeviations: number[];
    lastCarbTime: number;
    bwFound: boolean;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Aggregate recent carb treatments, calculate meal COB, and compute deviation data */
function recentCarbs(opts: RecentCarbsOpts, time: Date): RecentCarbsResult | Record<string, never> {
    const { treatments, profile: profileData } = opts;
    if (!treatments) {
        return {};
    }

    const cobInputs: COBInputs = {
        glucose_data: opts.glucose,
        iob_inputs: {
            profile: profileData,
            history: opts.pumphistory,
        },
        basalprofile: opts.basalprofile,
        mealTime: time.getTime(),
    };

    const maxMealAbsorptionTime = resolveMaxAbsorptionTime(profileData);
    const nowMs = time.getTime();
    const carbWindow = nowMs - maxMealAbsorptionTime * MS_PER_HOUR;

    // Sort treatments newest-first (mutates input array, matching original behavior)
    treatments.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Carb totals by source
    const totals = { nsCarbs: 0, bwCarbs: 0, journalCarbs: 0, bwFound: false };
    let carbs = 0;
    let mealCOB = 0;
    let lastCarbTime = 0;

    // Removal tracking for fully-absorbed earlier meals
    const removals = { carbs: 0, nsCarbs: 0, bwCarbs: 0, journalCarbs: 0 };

    for (const treatment of treatments) {
        const treatmentTime = new Date(treatment.timestamp).getTime();

        // Skip treatments outside the carb window
        if (treatmentTime <= carbWindow || treatmentTime > nowMs) {
            continue;
        }

        // Skip treatments with insufficient carbs
        if ((treatment.carbs ?? 0) < 1) {
            continue;
        }

        // Classify carbs by source
        accumulateCarbsByType(treatment, totals);
        carbs += treatment.carbs ?? 0;

        // Calculate COB with this treatment's timing
        cobInputs.mealTime = treatmentTime;
        lastCarbTime = Math.max(lastCarbTime, treatmentTime);
        const myCarbsAbsorbed = calcMealCOB(cobInputs).carbsAbsorbed;
        const myMealCOB = Math.max(0, carbs - myCarbsAbsorbed);

        if (typeof myMealCOB === 'number' && !isNaN(myMealCOB)) {
            mealCOB = Math.max(mealCOB, myMealCOB);
        } else {
            console.log(`Bad myMealCOB: ${myMealCOB} mealCOB: ${mealCOB} carbs: ${carbs} myCarbsAbsorbed: ${myCarbsAbsorbed}`);
        }

        // Track removal candidates for fully-absorbed earlier meals
        if (myMealCOB < mealCOB) {
            accumulateRemovalsByType(treatment, removals);
        } else {
            resetRemovalTotals(removals);
        }
    }

    // Subtract carbs from fully-absorbed earlier meals
    carbs -= removals.carbs;
    totals.nsCarbs -= removals.nsCarbs;
    totals.bwCarbs -= removals.bwCarbs;
    totals.journalCarbs -= removals.journalCarbs;

    // Calculate deviation data over the full absorption window
    cobInputs.carbImpactTime = nowMs;
    cobInputs.mealTime = nowMs - maxMealAbsorptionTime * MS_PER_HOUR;
    const deviationResult = calcMealCOB(cobInputs);

    // Apply maxCOB safety cap
    if (typeof profileData.maxCOB === 'number' && !isNaN(profileData.maxCOB)) {
        mealCOB = Math.min(profileData.maxCOB, mealCOB);
        console.log(`mealCOB: ${round(mealCOB, 1)} with maxCOB ${profileData.maxCOB}g and maxMealAbsorptionTime ${maxMealAbsorptionTime}hrs.`);
    } else {
        console.log(`Bad profile.maxCOB: ${profileData.maxCOB}`);
    }

    // Zombie-carb safety: zero COB when deviations are null/undefined
    mealCOB = applyZombieCarbSafety(mealCOB, deviationResult.currentDeviation, deviationResult.maxDeviation);

    return {
        carbs: roundTo3dp(carbs),
        nsCarbs: roundTo3dp(totals.nsCarbs),
        bwCarbs: roundTo3dp(totals.bwCarbs),
        journalCarbs: roundTo3dp(totals.journalCarbs),
        mealCOB: Math.round(mealCOB),
        currentDeviation: roundTo2dp(Number(deviationResult.currentDeviation)),
        maxDeviation: roundTo2dp(deviationResult.maxDeviation),
        minDeviation: roundTo2dp(deviationResult.minDeviation),
        slopeFromMaxDeviation: roundTo3dp(deviationResult.slopeFromMaxDeviation),
        slopeFromMinDeviation: roundTo3dp(deviationResult.slopeFromMinDeviation),
        allDeviations: deviationResult.allDeviations,
        lastCarbTime,
        bwFound: totals.bwFound,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve max meal absorption time from profile, falling back to default */
function resolveMaxAbsorptionTime(profile: IobProfile): number {
    if (typeof profile.maxMealAbsorptionTime === 'number' && !isNaN(profile.maxMealAbsorptionTime)) {
        return profile.maxMealAbsorptionTime;
    }
    console.log(`Bad profile.maxMealAbsorptionTime: ${profile.maxMealAbsorptionTime}`);
    return DEFAULT_MAX_MEAL_ABSORPTION_HOURS;
}

/** Classify and accumulate a treatment's carbs into the appropriate source bucket */
function accumulateCarbsByType(
    treatment: CarbTreatment,
    totals: { nsCarbs: number; bwCarbs: number; journalCarbs: number; bwFound: boolean },
): void {
    if ((treatment.nsCarbs ?? 0) >= 1) {
        totals.nsCarbs += treatment.nsCarbs ?? 0;
    } else if ((treatment.bwCarbs ?? 0) >= 1) {
        totals.bwCarbs += treatment.bwCarbs ?? 0;
        totals.bwFound = true;
    } else if ((treatment.journalCarbs ?? 0) >= 1) {
        totals.journalCarbs += treatment.journalCarbs ?? 0;
    } else {
        console.log(`Treatment carbs unclassified: ${JSON.stringify(treatment)}`);
    }
}

/** Track carbs from a fully-absorbed treatment for later subtraction (mirrors accumulateCarbsByType) */
function accumulateRemovalsByType(
    treatment: CarbTreatment,
    removals: { carbs: number; nsCarbs: number; bwCarbs: number; journalCarbs: number },
): void {
    removals.carbs += treatment.carbs ?? 0;
    if ((treatment.nsCarbs ?? 0) >= 1) {
        removals.nsCarbs += treatment.nsCarbs ?? 0;
    } else if ((treatment.bwCarbs ?? 0) >= 1) {
        removals.bwCarbs += treatment.bwCarbs ?? 0;
    } else if ((treatment.journalCarbs ?? 0) >= 1) {
        removals.journalCarbs += treatment.journalCarbs ?? 0;
    }
}

/** Reset removal counters when a non-absorbed meal is encountered */
function resetRemovalTotals(
    removals: { carbs: number; nsCarbs: number; bwCarbs: number; journalCarbs: number },
): void {
    removals.carbs = 0;
    removals.nsCarbs = 0;
    removals.bwCarbs = 0;
    // Note: journalCarbs intentionally not reset (matches original behavior)
}

/** Zero mealCOB when deviation data is null/undefined (zombie-carb safety) */
function applyZombieCarbSafety(
    mealCOB: number,
    currentDeviation: number | undefined,
    maxDeviation: number,
): number {
    if (currentDeviation === undefined || currentDeviation === null) {
        console.log("");
        console.log("Warning: setting mealCOB to 0 because currentDeviation is null/undefined");
        mealCOB = 0;
    }
    if (maxDeviation === undefined || maxDeviation === null) {
        console.log("");
        console.log("Warning: setting mealCOB to 0 because maxDeviation is 0 or undefined");
        mealCOB = 0;
    }
    return mealCOB;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
    recentCarbs,
    // Helpers
    round,
    resolveMaxAbsorptionTime,
    accumulateCarbsByType,
    accumulateRemovalsByType,
    resetRemovalTotals,
    applyZombieCarbSafety,
};
export type { RecentCarbsOpts, COBInputs, RecentCarbsResult };
