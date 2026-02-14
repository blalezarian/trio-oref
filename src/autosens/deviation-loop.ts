import { getCurrentBasalRate } from '../profile/basal';
import { generate as get_iob } from '../iob/index';
import { isfLookup } from '../profile/isf';
import { calculateBGImpact, calculateDeviation } from '../utils/glucose-math';
import { tempTargetRunning } from './temp-target';
import type { GlucoseEntry, CarbTreatment, ISODateString } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import type { TempTarget } from '../profile/targets';
import {
    MIN_BG_TARGET,
    EXERCISE_NORMAL_TARGET,
    DEFAULT_AUTOSENS_LOOKBACK,
    AUTOSENS_MIN_VALID_BG,
} from '../shared/constants';
import { resolveGlucoseTime } from '../utils/time';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Meal-start counter threshold: 9 intervals = ~45 minutes of exclusion */
const MEAL_EXCLUSION_COUNTER = 9;
/** Meal-start counter indicating >5h of absorption (60 intervals * 5m = 300m) */
const MEAL_ABSORPTION_LONG_COUNTER = 60;
/** Temp-target deviation divisor: (tempTarget - 100) / this */
const TEMP_TARGET_DEVIATION_DIVISOR = 20;
/** Minimum trailing buckets required for delta calculations */
const TRAILING_BUCKETS = 3;
/** Minimum COB threshold for "depleted" checks */
const COB_DEPLETED_THRESHOLD = 0.5;
/** Initial meal-start counter sentinel (well above all thresholds) */
const MEAL_START_COUNTER_INITIAL = 999;
/** IOB must exceed this multiple of current basal to trigger UAM detection */
const UAM_IOB_BASAL_MULTIPLIER = 2;
/** Minutes window at the top of each hour for hourly markers */
const HOURLY_MARKER_MINUTES = 5;
/** Neutral deviation inserted every N hours during long exclusion periods */
const NEUTRAL_DEVIATION_INTERVAL_HOURS = 2;
/** Minimum carbs in a treatment to count as a meal */
const MIN_MEAL_CARBS = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviationAnalysisResult {
    deviations: number[];
    avgDeltas: number[];
    bgis: number[];
}

// ---------------------------------------------------------------------------
// Main analysis loop
// ---------------------------------------------------------------------------

/** Run the main autosens deviation analysis loop */
export function analyzeDeviations(
    bucketedData: (GlucoseEntry & { mealCarbs?: number })[],
    meals: CarbTreatment[],
    iobInputs: { profile: IobProfile; history: unknown[]; clock: ISODateString },
    basalprofile: HistoryBasalProfileEntry[],
    profile: IobProfile,
    treatments: IobTreatment[],
    temptargets: TempTarget[] | undefined,
    retrospective: boolean | undefined,
    lookback: number | undefined,
): DeviationAnalysisResult {
    const avgDeltas: number[] = [];
    const bgis: number[] = [];
    const deviations: number[] = [];

    // State variables at function scope to preserve var-hoisted semantics
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: GlucoseEntry & { mealCarbs?: number };
    let BGDate: Date;
    let BGTime: number;
    let bgTime: Date | undefined;
    let lastBG: number;
    let oldBG: number;
    let displayCOB: number;

    // Meal absorption state machine
    let absorbing = 0;
    let uam = 0;
    let mealCOB = 0;
    let mealCarbs = 0;
    let mealStartCounter = MEAL_START_COUNTER_INITIAL;
    let deviationType: '' | 'csf' | 'uam' | 'non-meal' = '';
    let logLine = '';

    const isfProfileData = profile.isfProfile as NonNullable<typeof profile.isfProfile>;

    for (let bucketIdx = TRAILING_BUCKETS; bucketIdx < bucketedData.length; ++bucketIdx) {
        const entry = bucketedData[bucketIdx];
        bgTime = entry.date != null
            ? new Date(entry.date)
            : (resolveGlucoseTime(entry) ?? new Date(NaN));
        const sens = isfLookup(isfProfileData, bgTime);

        // -----------------------------------------------------------------
        // Phase 1: Validate BG and compute deltas
        // -----------------------------------------------------------------
        let bg: number;
        let avgDelta: number;
        let delta: number;

        if (bucketedData[bucketIdx].glucose !== undefined) {
            bg = Number(bucketedData[bucketIdx].glucose);
            lastBG = Number(bucketedData[bucketIdx - 1].glucose);
            oldBG = Number(bucketedData[bucketIdx - TRAILING_BUCKETS].glucose);

            if (isNaN(bg) || !bg || bg < AUTOSENS_MIN_VALID_BG
                || isNaN(oldBG) || !oldBG || oldBG < AUTOSENS_MIN_VALID_BG
                || isNaN(lastBG) || !lastBG || lastBG < AUTOSENS_MIN_VALID_BG) {
                logLine += "!";
                continue;
            }

            avgDelta = (bg - oldBG) / TRAILING_BUCKETS;
            delta = bg - lastBG;
        } else {
            console.log("Could not find glucose data");
            continue;
        }

        // -----------------------------------------------------------------
        // Phase 2: Calculate IOB and deviation
        // -----------------------------------------------------------------
        avgDelta = parseFloat(avgDelta.toFixed(2));
        iobInputs.clock = bgTime.toISOString();
        iobInputs.profile.current_basal = Number(getCurrentBasalRate(basalprofile, bgTime));
        iobInputs.profile.temptargetSet = false;
        const iob = get_iob(iobInputs as IobInputs, true, treatments)[0];

        const bgImpact = calculateBGImpact(iob.activity, sens);
        let deviation = NaN;
        if (isNaN(delta)) {
            console.log(`Bad delta: ${delta} ${bg} ${lastBG} ${oldBG}`);
        } else {
            deviation = calculateDeviation(delta, bgImpact, bg, MIN_BG_TARGET);
        }

        // -----------------------------------------------------------------
        // Phase 3: Track meal COB from treatment history
        // -----------------------------------------------------------------
        glucoseDatum = bucketedData[bucketIdx];
        BGDate = new Date(Number(glucoseDatum.date));
        BGTime = BGDate.getTime();

        treatment = meals[meals.length - 1];
        if (treatment) {
            treatmentDate = new Date(treatment.timestamp);
            treatmentTime = treatmentDate.getTime();
            if (treatmentTime < BGTime) {
                if ((treatment.carbs ?? 0) >= MIN_MEAL_CARBS) {
                    mealCOB += treatment.carbs ?? 0;
                    mealCarbs += treatment.carbs ?? 0;
                    displayCOB = Math.round(mealCOB);
                    logLine += `${displayCOB}g`;
                }
                meals.pop();
            }
        }

        // -----------------------------------------------------------------
        // Phase 4: Calculate carb absorption for this 5m interval
        // -----------------------------------------------------------------
        if (mealCOB > 0) {
            const carbImpact = Math.max(deviation, Number(profile.min_5m_carbimpact));
            const absorbed = carbImpact * Number(profile.carb_ratio) / sens;
            if (absorbed) {
                mealCOB = Math.max(0, mealCOB - absorbed);
            } else {
                console.log(`${absorbed} ${carbImpact} ${profile.carb_ratio} ${sens} ${deviation} ${profile.min_5m_carbimpact}`);
            }
        }

        // -----------------------------------------------------------------
        // Phase 5: Classify deviation type (csf / uam / non-meal)
        // -----------------------------------------------------------------
        if (mealCOB > 0 || absorbing || mealCarbs > 0) {
            // --- CSF (carb sensitivity factor) path ---
            absorbing = deviation > 0 ? 1 : 0;

            // Stop excluding after >5h absorption with COB depleted
            if (mealStartCounter > MEAL_ABSORPTION_LONG_COUNTER && mealCOB < COB_DEPLETED_THRESHOLD) {
                displayCOB = Math.round(mealCOB);
                logLine += `${displayCOB}g`;
                absorbing = 0;
            }
            if (!absorbing && mealCOB < COB_DEPLETED_THRESHOLD) {
                mealCarbs = 0;
            }

            // Mark meal absorption start (first time entering csf)
            if (deviationType !== "csf") {
                logLine += "(";
                mealStartCounter = 0;
            }
            mealStartCounter++;
            deviationType = "csf";
            glucoseDatum.mealCarbs = mealCarbs;
        } else {
            // --- Non-meal path ---
            if (deviationType === "csf") {
                logLine += ")";
            }

            const currentBasal = iobInputs.profile.current_basal;

            // UAM (unannounced meal) detection
            if ((!retrospective && iob.iob > UAM_IOB_BASAL_MULTIPLIER * currentBasal) || uam || mealStartCounter < MEAL_EXCLUSION_COUNTER) {
                mealStartCounter++;
                uam = deviation > 0 ? 1 : 0;

                if (deviationType !== "uam") {
                    logLine += "u(";
                }
                deviationType = "uam";
            } else {
                if (deviationType === "uam") {
                    logLine += ")";
                }
                deviationType = "non-meal";
            }
        }

        // -----------------------------------------------------------------
        // Phase 6: Record non-meal deviations for autosens calculation
        // -----------------------------------------------------------------
        if (deviationType === "non-meal") {
            if (deviation > 0) {
                logLine += "+";
            } else if (deviation === 0) {
                logLine += "=";
            } else {
                logLine += "-";
            }
            avgDeltas.push(avgDelta);
            bgis.push(bgImpact);
            deviations.push(deviation);

        } else {
            logLine += "x";
        }

        // -----------------------------------------------------------------
        // Phase 7: Exercise mode temp target adjustments
        // -----------------------------------------------------------------
        if (profile.high_temptarget_raises_sensitivity === true || profile.exercise_mode === true) {
            const tempTarget = tempTargetRunning(temptargets, bgTime ?? new Date(NaN));
            if ((tempTarget ?? 0) > EXERCISE_NORMAL_TARGET) {
                const tempDeviation = -(Number(tempTarget) - EXERCISE_NORMAL_TARGET) / TEMP_TARGET_DEVIATION_DIVISOR;
                logLine += "-";
                deviations.push(tempDeviation);
            }
        }

        // -----------------------------------------------------------------
        // Phase 8: Hourly markers and lookback window
        // -----------------------------------------------------------------
        const minutes = (bgTime ?? new Date(NaN)).getMinutes();
        const hours = (bgTime ?? new Date(NaN)).getHours();
        if (minutes >= 0 && minutes < HOURLY_MARKER_MINUTES) {
            logLine += `${hours}h`;
            // Add one neutral deviation every 2h to help decay over long exclusion periods
            if (hours % NEUTRAL_DEVIATION_INTERVAL_HOURS === 0) {
                deviations.push(0);
                logLine += "=";
            }
        }

        const deviationLookback = lookback || DEFAULT_AUTOSENS_LOOKBACK;
        if (deviations.length > deviationLookback) {
            deviations.shift();
        }
    }

    console.log(logLine);

    return { deviations, avgDeltas, bgis };
}
