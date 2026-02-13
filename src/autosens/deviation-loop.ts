import { getCurrentBasalRate } from '../profile/basal';
import get_iob from '../iob/index';
import { isfLookup } from '../profile/isf';
import { calculateBGImpact, calculateDeviation } from '../utils/glucose-math';
import { tempTargetRunning } from './temp-target';
import type { GlucoseEntry, CarbTreatment } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import type { TempTarget } from '../profile/targets';
import {
    MIN_BG_TARGET,
    EXERCISE_NORMAL_TARGET,
    DEFAULT_AUTOSENS_LOOKBACK,
    AUTOSENS_MIN_VALID_BG,
} from '../constants';

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviationAnalysisResult {
    deviations: number[];
    avgDeltas: number[];
    bgis: number[];
    deviationSum: number;
}

// ---------------------------------------------------------------------------
// Main analysis loop
// ---------------------------------------------------------------------------

/** Run the main autosens deviation analysis loop */
export function analyzeDeviations(
    bucketed_data: (GlucoseEntry & { mealCarbs?: number })[],
    meals: CarbTreatment[],
    iob_inputs: { profile: IobProfile; history: unknown[]; clock: string | Date },
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
    let deviationSum = 0;

    // State variables at function scope to preserve var-hoisted semantics
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: GlucoseEntry & { mealCarbs?: number };
    let BGDate: Date;
    let BGTime: number;
    let bgTime: Date | undefined;
    let last_bg: number;
    let old_bg: number;
    let displayCOB: number;

    // Meal absorption state machine
    let absorbing = 0;
    let uam = 0;
    let mealCOB = 0;
    let mealCarbs = 0;
    let mealStartCounter = 999;
    let type = "";

    for (let i = TRAILING_BUCKETS; i < bucketed_data.length; ++i) {
        bgTime = new Date(bucketed_data[i].date!);
        const sens = isfLookup(profile.isfProfile!, bgTime);

        // -----------------------------------------------------------------
        // Phase 1: Validate BG and compute deltas
        // -----------------------------------------------------------------
        let bg: number;
        let avgDelta: number;
        let delta: number;

        if (bucketed_data[i].glucose !== undefined) {
            bg = bucketed_data[i].glucose!;
            last_bg = bucketed_data[i - 1].glucose!;
            old_bg = bucketed_data[i - TRAILING_BUCKETS].glucose!;

            if (isNaN(bg) || !bg || bg < AUTOSENS_MIN_VALID_BG
                || isNaN(old_bg) || !old_bg || old_bg < AUTOSENS_MIN_VALID_BG
                || isNaN(last_bg) || !last_bg || last_bg < AUTOSENS_MIN_VALID_BG) {
                process.stderr.write("!");
                continue;
            }

            avgDelta = (bg - old_bg) / TRAILING_BUCKETS;
            delta = bg - last_bg;
        } else {
            console.error("Could not find glucose data");
            continue;
        }

        // -----------------------------------------------------------------
        // Phase 2: Calculate IOB and deviation
        // -----------------------------------------------------------------
        avgDelta = parseFloat(avgDelta.toFixed(2));
        iob_inputs.clock = bgTime;
        iob_inputs.profile.current_basal = getCurrentBasalRate(basalprofile, bgTime)!;
        iob_inputs.profile.temptargetSet = false;
        const iob = get_iob(iob_inputs as IobInputs, true, treatments)[0];

        const bgImpact = calculateBGImpact(iob.activity, sens);
        let deviation!: number;
        if (isNaN(delta)) {
            console.error("Bad delta: ", delta, bg, last_bg, old_bg);
        } else {
            deviation = calculateDeviation(delta, bgImpact, bg, MIN_BG_TARGET);
        }

        // -----------------------------------------------------------------
        // Phase 3: Track meal COB from treatment history
        // -----------------------------------------------------------------
        glucoseDatum = bucketed_data[i];
        BGDate = new Date(glucoseDatum.date!);
        BGTime = BGDate.getTime();

        treatment = meals[meals.length - 1];
        if (treatment) {
            treatmentDate = new Date(treatment.timestamp);
            treatmentTime = treatmentDate.getTime();
            if (treatmentTime < BGTime) {
                if ((treatment.carbs ?? 0) >= 1) {
                    mealCOB += treatment.carbs ?? 0;
                    mealCarbs += treatment.carbs ?? 0;
                    displayCOB = Math.round(mealCOB);
                    process.stderr.write(`${displayCOB}g`);
                }
                meals.pop();
            }
        }

        // -----------------------------------------------------------------
        // Phase 4: Calculate carb absorption for this 5m interval
        // -----------------------------------------------------------------
        if (mealCOB > 0) {
            const carbImpact = Math.max(deviation, profile.min_5m_carbimpact!);
            const absorbed = carbImpact * profile.carb_ratio! / sens;
            if (absorbed) {
                mealCOB = Math.max(0, mealCOB - absorbed);
            } else {
                console.error(absorbed, carbImpact, profile.carb_ratio, sens, deviation, profile.min_5m_carbimpact);
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
                process.stderr.write(`${displayCOB}g`);
                absorbing = 0;
            }
            if (!absorbing && mealCOB < COB_DEPLETED_THRESHOLD) {
                mealCarbs = 0;
            }

            // Mark meal absorption start (first time entering csf)
            if (type !== "csf") {
                process.stderr.write("(");
                mealStartCounter = 0;
            }
            mealStartCounter++;
            type = "csf";
            glucoseDatum.mealCarbs = mealCarbs;
        } else {
            // --- Non-meal path ---
            if (type === "csf") {
                process.stderr.write(")");
            }

            const currentBasal = iob_inputs.profile.current_basal;

            // UAM (unannounced meal) detection
            if ((!retrospective && iob.iob > 2 * currentBasal) || uam || mealStartCounter < MEAL_EXCLUSION_COUNTER) {
                mealStartCounter++;
                uam = deviation > 0 ? 1 : 0;

                if (type !== "uam") {
                    process.stderr.write("u(");
                }
                type = "uam";
            } else {
                if (type === "uam") {
                    process.stderr.write(")");
                }
                type = "non-meal";
            }
        }

        // -----------------------------------------------------------------
        // Phase 6: Record non-meal deviations for autosens calculation
        // -----------------------------------------------------------------
        if (type === "non-meal") {
            if (deviation > 0) {
                process.stderr.write("+");
            } else if (deviation === 0) {
                process.stderr.write("=");
            } else {
                process.stderr.write("-");
            }
            avgDeltas.push(avgDelta);
            bgis.push(bgImpact);
            deviations.push(deviation);
            deviationSum += deviation;
        } else {
            process.stderr.write("x");
        }

        // -----------------------------------------------------------------
        // Phase 7: Exercise mode temp target adjustments
        // -----------------------------------------------------------------
        if (profile.high_temptarget_raises_sensitivity === true || profile.exercise_mode === true) {
            const tempTarget = tempTargetRunning(temptargets, bgTime!);
            if ((tempTarget ?? 0) > EXERCISE_NORMAL_TARGET) {
                const tempDeviation = -(tempTarget! - EXERCISE_NORMAL_TARGET) / TEMP_TARGET_DEVIATION_DIVISOR;
                process.stderr.write("-");
                deviations.push(tempDeviation);
            }
        }

        // -----------------------------------------------------------------
        // Phase 8: Hourly markers and lookback window
        // -----------------------------------------------------------------
        const minutes = bgTime!.getMinutes();
        const hours = bgTime!.getHours();
        if (minutes >= 0 && minutes < 5) {
            process.stderr.write(`${hours}h`);
            // Add one neutral deviation every 2h to help decay over long exclusion periods
            if (hours % 2 === 0) {
                deviations.push(0);
                process.stderr.write("=");
            }
        }

        const deviationLookback = lookback || DEFAULT_AUTOSENS_LOOKBACK;
        if (deviations.length > deviationLookback) {
            deviations.shift();
        }
    }

    process.stderr.write(" ");

    return { deviations, avgDeltas, bgis, deviationSum };
}
