import { calcTempTreatments as findInsulin } from '../iob/extract-treatments';
import { findMealInputs as findMeals } from '../meal/history';
import { normalizeGlucoseData } from '../utils/glucose-math';
import { resolveGlucoseTime } from '../utils/time';
import type { PumpHistoryEvent, GlucoseEntry, CarbTreatment, ISODateString } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import type { TempTarget } from '../profile/targets';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    HOURS_PER_DAY,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface AutosensInputs {
    glucose_data: GlucoseEntry[];
    iob_inputs: {
        profile: IobProfile;
        history: PumpHistoryEvent[];
        clock: ISODateString;
    };
    basalprofile: HistoryBasalProfileEntry[];
    carbs: PumpHistoryEvent[];
    temptargets?: TempTarget[];
    retrospective?: boolean;
    deviations?: number;
}

export interface PreparedAutosensData {
    treatments: IobTreatment[];
    meals: CarbTreatment[];
    bucketed_data: (GlucoseEntry & { mealCarbs?: number })[];
    lastSiteChange: Date;
    iob_inputs: AutosensInputs['iob_inputs'];
    basalprofile: HistoryBasalProfileEntry[];
    profile: IobProfile;
}

// ---------------------------------------------------------------------------
// Site change detection
// ---------------------------------------------------------------------------

/** Determine lookback window based on site change / rewind history */
export function determineSiteChangeTime(
    glucoseData: GlucoseEntry[],
    retrospective: boolean | undefined,
    history: PumpHistoryEvent[],
    rewindResetsAutosens: boolean | undefined,
): Date {
    // Default: 24h lookback from first glucose reading (retrospective) or now
    let lastSiteChange: Date;
    if (retrospective) {
        lastSiteChange = new Date(new Date(Number(glucoseData[0].date)).getTime() - HOURS_PER_DAY * MS_PER_HOUR);
    } else {
        lastSiteChange = new Date(Date.now() - HOURS_PER_DAY * MS_PER_HOUR);
    }

    if (rewindResetsAutosens !== true) {
        return lastSiteChange;
    }

    // Scan pump history for last Rewind event (skip index 0)
    for (let historyIdx = 1; historyIdx < history.length; ++historyIdx) {
        if (!history[historyIdx]._type || history[historyIdx]._type !== 'Rewind') {
            continue;
        }
        if (history[historyIdx].timestamp) {
            lastSiteChange = new Date(String(history[historyIdx].timestamp));
            console.log(`Setting lastSiteChange to ${lastSiteChange} using timestamp ${history[historyIdx].timestamp}`);
            break;
        }
    }

    return lastSiteChange;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve lastbgTime from three sources in priority order:
 * 1. Previous glucose entry (display_time / dateString via resolveGlucoseTime)
 * 2. First bucketed entry (display_time only — matches original behavior)
 * 3. Previous entry has xDrip_started_at → returns 'skip' sentinel
 * 4. None → returns undefined (error path)
 */
export function resolveLastBgTime(
    prevEntry: GlucoseEntry,
    firstBucket: GlucoseEntry,
): Date | 'skip' | undefined {
    const fromPrev = resolveGlucoseTime(prevEntry);
    if (fromPrev) {
        return fromPrev;
    }

    if (firstBucket.display_time) {
        return new Date(firstBucket.display_time.replace('T', ' '));
    }

    if (prevEntry.xDrip_started_at) {
        return 'skip';
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// Data preparation
// ---------------------------------------------------------------------------

/** Prepare all data needed for autosens analysis */
export function prepareAutosensData(inputs: AutosensInputs): PreparedAutosensData {
    const glucoseData = normalizeGlucoseData(inputs.glucose_data);
    const iobInputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    const profile = iobInputs.profile;

    const lastSiteChange = determineSiteChangeTime(
        glucoseData,
        inputs.retrospective,
        iobInputs.history,
        iobInputs.profile.rewind_resets_autosens,
    );

    // Extract treatments from pump history once (not every get_iob call)
    const treatments = findInsulin(iobInputs as IobInputs);

    const mealInputs = {
        history: iobInputs.history,
        profile,
        carbs: inputs.carbs,
        glucose: inputs.glucose_data,
    };
    const meals = findMeals(mealInputs);
    meals.sort((a: CarbTreatment, b: CarbTreatment) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // --- Bucket glucose data (oldest-first) ---
    const bucketedData: (GlucoseEntry & { mealCarbs?: number })[] = [];
    glucoseData.reverse();
    bucketedData[0] = glucoseData[0];
    let bucketIndex = 0;

    // bgTime and lastbgTime at function scope to preserve var-hoisted semantics
    let bgTime: Date | undefined;
    let lastbgTime: Date | undefined;

    for (let glucoseIdx = 1; glucoseIdx < glucoseData.length; ++glucoseIdx) {
        // --- Resolve current entry time ---
        const resolvedBgTime = resolveGlucoseTime(glucoseData[glucoseIdx]);
        if (resolvedBgTime) {
            bgTime = resolvedBgTime;
        } else if (glucoseData[glucoseIdx].xDrip_started_at) {
            continue;
        } else {
            console.log("Could not determine BG time");
        }

        // --- Resolve previous entry time (3-source fallback) ---
        const resolvedLastTime = resolveLastBgTime(glucoseData[glucoseIdx - 1], bucketedData[0]);
        if (resolvedLastTime === 'skip') {
            continue;
        }
        if (resolvedLastTime) {
            lastbgTime = resolvedLastTime;
        } else {
            console.log("Could not determine last BG time");
        }

        // Skip invalid glucose values (as number preserves undefined→NaN passthrough)
        if ((Number(glucoseData[glucoseIdx].glucose)) < MIN_VALID_GLUCOSE_MGDL
            || Number(glucoseData[glucoseIdx - 1].glucose) < MIN_VALID_GLUCOSE_MGDL) {
            continue;
        }

        // Only consider BGs since last site change
        if (lastSiteChange) {
            const hoursSinceSiteChange = ((bgTime ? bgTime.getTime() : NaN) - lastSiteChange.getTime()) / MS_PER_HOUR;
            if (hoursSinceSiteChange < 0) {
                continue;
            }
        }

        // --- Bucket or merge based on elapsed time ---
        const elapsedMinutes = ((bgTime ? bgTime.getTime() : NaN) - (lastbgTime ? lastbgTime.getTime() : NaN)) / MS_PER_MINUTE;

        if (Math.abs(elapsedMinutes) > BUCKETING_MERGE_THRESHOLD_MIN) {
            bucketIndex++;
            bucketedData[bucketIndex] = glucoseData[glucoseIdx];
            bucketedData[bucketIndex].date = bgTime ? bgTime.getTime() : NaN;
        } else {
            bucketedData[bucketIndex].glucose =
                (Number(bucketedData[bucketIndex].glucose) + (Number(glucoseData[glucoseIdx].glucose))) / 2;
        }
    }

    // Remove seed entry (bucketedData[0] was the initial glucose reading)
    bucketedData.shift();

    // --- Remove meals older than oldest bucketed glucose ---
    // Variables at function scope to preserve var-hoisted semantics
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: GlucoseEntry & { mealCarbs?: number };
    let BGDate: Date;
    let BGTime: number;

    for (let mealIdx = meals.length - 1; mealIdx > 0; --mealIdx) {
        treatment = meals[mealIdx];
        if (!treatment) {
            continue;
        }

        treatmentDate = new Date(treatment.timestamp);
        treatmentTime = treatmentDate.getTime();
        glucoseDatum = bucketedData[0];

        if (!glucoseDatum || !glucoseDatum.date) {
            continue;
        }

        BGDate = new Date(glucoseDatum.date);
        BGTime = BGDate.getTime();

        if (treatmentTime < BGTime) {
            meals.splice(mealIdx, 1);
        }
    }

    return {
        treatments,
        meals,
        bucketed_data: bucketedData,
        lastSiteChange,
        iob_inputs: iobInputs,
        basalprofile,
        profile,
    };
}
