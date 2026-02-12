/*
  Determine Basal
  Released under MIT license. See the accompanying LICENSE.txt file for
  full terms and conditions
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
  THE SOFTWARE.
*/

// Define various functions used later on, in the main function determine_basal() below

import round_basal from '../round-basal';

import {
    MGDL_TO_MMOL,
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    PRED_BG_MAX_LENGTH,
    PRED_INTERVAL_MINUTES,
    EXERCISE_NORMAL_TARGET,
    EXERCISE_HALF_BASAL_TARGET,
    TEMP_BASAL_DURATION_MINUTES,
    MAX_TEMP_BASAL_DURATION_MINUTES,
    DEFAULT_SMB_DELIVERY_RATIO,
    DEFAULT_SMB_INTERVAL_MINUTES,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
    MIN_BG_TARGET,
    MAX_BG_TARGET,
    DYNAMIC_ISF_LOG_DENOMINATOR,
    MIN_VALID_GLUCOSE_MGDL,
    MAX_VALID_GLUCOSE_MGDL,
    INSULIN_PEAK_WAIT_MINUTES,
    RAPID_ACTING_ACTIVITY_OFFSET,
    ULTRA_RAPID_ACTIVITY_OFFSET,
    INSULIN_FACTOR_CEILING,
    DEFAULT_MAX_CARB_ABSORPTION_RATE,
    DEFAULT_ASSUMED_CARB_ABSORPTION_RATE,
    DEFAULT_REMAINING_CA_TIME_MIN_HOURS,
    DEFAULT_REMAINING_CARBS_CAP,
} from '../constants';

import type {
    GlucoseStatus,
    CurrentTemp,
    IOBData,
    BasalEntry,
    Profile,
    AutosensData,
    MealData,
    TempBasalFunctions,
    Preferences,
    DetermineBasalResult,
    TrioCustomVariables,
} from '../types/index';

// === Local constants for determine-basal ===

// --- Data quality / error thresholds ---
/** CGM calibrating or error state ceiling (mg/dL) */
const BG_ERROR_CEILING = 10;
/** xDrip sensor failure error code */
const XDRIP_ERROR_CODE = 38;
/** CGM noise level at or above which data is considered unreliable */
const CGM_NOISE_LEVEL_MEDIUM = 3;
/** Suppress unchanged-data warnings below this BG (mg/dL) */
const BG_UNCHANGED_FLOOR = 60;
/** BG data older than this (minutes) is considered too old */
const MAX_BG_DATA_AGE_MINUTES = 12;
/** BG data from further in the future than this (minutes) is invalid */
const MAX_BG_FUTURE_MINUTES = 5;
/** Calibration recency threshold (minutes) — just calibrated */
const RECENT_CAL_THRESHOLD = 3;

// --- Target BG adjustment ---
/** Pivot point for autosens-based target BG adjustment (mg/dL) */
const TARGET_BG_PIVOT = 60;
/** Minimum multiplier for noisy CGM target raise */
const MIN_NOISY_TARGET_MULTIPLIER = 1.1;
/** Maximum raw BG value considered valid for noise adjustment */
const MAX_RAW_BG = 250;

// --- Threshold calculation ---
/** Factor applied to (min_bg - offset) for threshold computation */
const THRESHOLD_FACTOR = 0.5;
/** Offset subtracted from min_bg in threshold formula (mg/dL) */
const THRESHOLD_BG_OFFSET = 40;
/** Minimum allowed threshold BG (mg/dL) */
const MIN_THRESHOLD_BG = 60;
/** Maximum allowed threshold BG (mg/dL) */
const MAX_THRESHOLD_BG = 120;

// --- Temp basal decision thresholds ---
/** Temp age (minutes) above which a rate mismatch triggers cancellation */
const TEMP_AGE_STALE_MINUTES = 10;
/** Minutes since last temp ended to trigger cancellation */
const TEMP_END_GAP_MINUTES = 5;
/** Minimum remaining temp duration (minutes) to consider it "active" */
const TEMP_ACTIVE_DURATION_MINUTES = 15;
/** Short temp duration threshold (minutes) */
const TEMP_SHORT_DURATION_MINUTES = 5;
/** Low rate tolerance factor for current temp comparison */
const RATE_TOLERANCE_LOW = 0.8;
/** Fraction of basal below which scheduled insulin is considered a shortfall */
const BASAL_SHORTFALL_FRACTION = 0.3;
/** Factor applied to insulinReq when current temp delivers too much */
const INSULIN_OVERSHOOT_FACTOR = 2;

// --- Low glucose / safety ---
/** BG floor (mg/dL) for safety checks on naive/carbs-required eventualBG */
const LOW_BG_SAFETY_THRESHOLD = 40;
/** Minutes of negative IOB to check before suppressing LGS */
const IOB_NEG_CHECK_MINUTES = 20;
/** Multiplier for low-temp insulin correction */
const LOW_TEMP_CORRECTION_FACTOR = 2;

// --- Prediction durations ---
/** Maximum prediction horizon (minutes) for above-min/above-threshold checks */
const PRED_HORIZON_MAX_MINUTES = 240;
/** Threshold (minutes above min_bg) that triggers carbs-required evaluation */
const MINUTES_ABOVE_MIN_BG_THRESHOLD = 60;
/** Window (minutes above threshold) within which carbsReq is displayed */
const CARBS_REQ_WINDOW_MINUTES = 45;

// --- Carb absorption ---
/** Extension factor applied to lastCarbAge for remainingCATime */
const CARB_TIME_EXTENSION_FACTOR = 1.5;
/** Fraction of COB discounted when computing carbsReq */
const COB_DISCOUNT_FRACTION = 0.25;
/** Hours over which UAM deviation impact decays to zero */
const UAM_DECAY_HOURS = 3;

// --- Prediction array trimming ---
/** Minimum data points to retain when trimming flat prediction tails */
const MIN_PRED_TRIM_POINTS = 12;
/** Minimum data points to retain when trimming ZT predictions */
const MIN_ZT_TRIM_POINTS = 6;
/** Upper cap for COB predicted BG (mg/dL) */
const COB_PRED_BG_CAP = 1500;

// --- Dynamic ISF exercise threshold ---
/** Target BG (mg/dL) at/above which dynamic ISF is disabled during exercise */
const DYNISF_EXERCISE_THRESHOLD = 118;

// --- SMB settings ---
/** Minimum SMB interval (minutes) */
const MIN_SMB_INTERVAL_MINUTES = 1;
/** Maximum SMB interval (minutes) */
const MAX_SMB_INTERVAL_MINUTES = 10;
/** Default maxDelta BG threshold fraction for SMB disablement */
const DEFAULT_MAX_DELTA_BG_THRESHOLD = 0.2;
/** Safety cap for maxDelta BG threshold fraction */
const MAX_DELTA_BG_THRESHOLD_CAP = 0.4;
/** Maximum duration (minutes) for SMB zero-temp */
const SMB_MAX_ZERO_TEMP_MINUTES = 60;

// --- Neutral temp near top of hour ---
/** Minutes before the hour at which neutral temps are cancelled */
const TOP_OF_HOUR_WINDOW_MINUTES = 55;

// --- Calculation parameters ---
/** Hours over which expectedDelta is calculated */
const EXPECTED_DELTA_HOURS = 2;
/** CGM noise level at or above which target BG is raised for safety */
const CGM_NOISE_LEVEL_NOISY = 2;
/** Delta threshold (mg/dL) below which BG change is considered negligible */
const DELTA_UNCHANGED_THRESHOLD = 1;
/** Divisor for triangular (linear decay) carb impact area calculation */
const LINEAR_DECAY_FACTOR = 2;
/** Divisor for dampening slope from minimum deviation */
const SLOPE_DAMPENING_DIVISOR = 3;
/** Sentinel BG value meaning "no prediction calculated yet" */
const PRED_BG_SENTINEL = 999;
/** Delta difference threshold (mg/dL) for classifying glucose change significance */
const DELTA_SIGNIFICANCE_THRESHOLD = 2;
/** Override target sentinel meaning "not set" (~0.33 mmol/L, impossibly low as a real target) */
const OVERRIDE_TARGET_SENTINEL = 6;
/** Seconds per minute — used for minutes-to-seconds display conversion */
const SECONDS_PER_MINUTE = 60;

// --- Manual bolus error codes (sent to Trio iOS app) ---
/** Guard BG below safety threshold */
const BOLUS_ERR_GUARD_BELOW_THRESHOLD = 1;
/** LGS mode: guard BG below threshold */
const BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD = 2;
/** BG rising slower than expected */
const BOLUS_ERR_RISING_SLOWER = 3;
/** BG falling or mixed direction */
const BOLUS_ERR_FALLING_OR_MIXED = 4;
/** Other delta mismatch */
const BOLUS_ERR_OTHER_DELTA = 5;
/** Min predicted BG below minimum target */
const BOLUS_ERR_MIN_PRED_BELOW_MIN = 6;

// --- Default trio_custom_variables ---
const DEFAULT_TRIO_CUSTOM_VARIABLES: TrioCustomVariables = {
    useOverride: false, overridePercentage: 100, overrideTarget: 0,
    advancedSettings: false, isfAndCr: false, isf: false, cr: false,
    smbIsOff: false, smbIsScheduledOff: false, start: 0, end: 0,
    smbMinutes: 30, uamMinutes: 30, currentTDD: 0,
    average_total_data: 0, weightedAverage: 0, duration: 0
};

// Rounds value to 'digits' decimal places
function round(value: number, digits?: number): number {
    if (! digits) { digits = 0; }
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

// we expect BG to rise or fall at the rate of BGI,
// adjusted by the rate at which BG would need to rise /
// fall to get eventualBG to target over 2 hours
function calculate_expected_delta(target_bg: number, eventual_bg: number, bgi: number): number {
    // (hours * mins_per_hour) / 5 = how many 5 minute periods in 2h = 24
    const five_min_blocks = (EXPECTED_DELTA_HOURS * MINUTES_PER_HOUR) / PRED_INTERVAL_MINUTES;
    const target_delta = target_bg - eventual_bg;
    return /* expectedDelta */ round(bgi + (target_delta / five_min_blocks), 1);
}


function convert_bg(value: number, profile: Profile): number
{
    if (profile.out_units === "mmol/L")
    {
        return round(value * MGDL_TO_MMOL,1);
    }
    else
    {
        return Math.round(value);
    }
}
function enable_smb(profile: Profile, microBolusAllowed: boolean, meal_data: MealData, bg: number, target_bg: number, high_bg: number, trio_custom_variables: TrioCustomVariables, time: Date): boolean {
    if (trio_custom_variables.smbIsScheduledOff){
        /* Below logic is related to profile overrides which can disable SMBs or disable them for a scheduled window.
         * SMBs will be disabled from [start, end), such that if an SMB is scheduled to be disabled from 10 AM to 2 PM,
         * an SMB will not be allowed from 10:00:00 until 1:59:59.
         */
        // BUG: new Date(time.getHours()) creates a Date from epoch ms, not the hour number.
        // This breaks SMB time-range scheduling (currentHour is always a Date, not 0-23).
        let currentHour = new Date(time.getHours()) as unknown as number;
        let startTime = trio_custom_variables.start;
        let endTime = trio_custom_variables.end;

        if (startTime < endTime && (currentHour >= startTime && currentHour < endTime)) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false
        } else if (startTime > endTime && (currentHour >= startTime || currentHour < endTime)) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false
        } else if (startTime == 0 && endTime == 0) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false;
        } else if (startTime == endTime && currentHour == startTime) {
            console.error("SMB disabled: current time is in SMB disabled scheduled")
            return false;
        }
    }
    // disable SMB when a high temptarget is set
    if (! microBolusAllowed) {
        console.error("SMB disabled (!microBolusAllowed)");
        return false;
    } else if (! profile.allowSMB_with_high_temptarget && profile.temptargetSet && target_bg > EXERCISE_NORMAL_TARGET) {
        console.error("SMB disabled due to high temptarget of " + target_bg);
        return false;
    } else if (meal_data.bwFound === true && profile.A52_risk_enable === false) {
        console.error("SMB disabled due to Bolus Wizard activity in the last 6 hours.");
        return false;
    }

    // enable SMB/UAM if always-on (unless previously disabled for high temptarget)
    if (profile.enableSMB_always === true) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled due to enableSMB_always");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) while we have COB
    if (profile.enableSMB_with_COB === true && meal_data.mealCOB) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for COB of " + meal_data.mealCOB);
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) for a full 6 hours after any carb entry
    // (6 hours is defined in carbWindow in src/meal/total.ts)
    if (profile.enableSMB_after_carbs === true && meal_data.carbs ) {
        if (meal_data.bwCarbs) {
            console.error("Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for 6h after carb entry");
        }
        return true;
    }

    // enable SMB/UAM (if enabled in preferences) if a low temptarget is set
    if (profile.enableSMB_with_temptarget === true && (profile.temptargetSet && target_bg < EXERCISE_NORMAL_TARGET)) {
        if (meal_data.bwFound) {
            console.error("Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("SMB enabled for temptarget of " + convert_bg(target_bg, profile));
        }
        return true;
    }

    // enable SMB if high bg is found
    if (profile.enableSMB_high_bg === true && high_bg !== null && bg >= high_bg) {
        console.error("Checking BG to see if High for SMB enablement.");
        console.error("Current BG", bg, " | High BG ", high_bg);
        if (meal_data.bwFound) {
            console.error("Warning: High BG SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard");
        } else {
            console.error("High BG detected. Enabling SMB.");
        }
        return true;
    }

    console.error("SMB disabled (no enableSMB preferences active or no condition satisfied)");
    return false;
}


interface DynamicISFResult {
    dynISFenabled: boolean;
    tdd: number;
    tddReason: string;
    newRatio: number;
    insulinFactor: number;
    adjustmentFactor: number;
    enable_sigmoid: boolean;
    tdd24h_14d_Ratio: number;
}

function calculateDynamicISF(
    glucose_status: GlucoseStatus,
    profile: Profile,
    preferences: Preferences,
    autosens_data: AutosensData,
    sensitivity: number,
    profileTarget: number,
    dynISFenabled: boolean,
    tdd: number,
    weightedAverage: number,
    average_total_data: number,
    weightPercentage: number,
    middleWare: ((arg: DetermineBasalResult) => DetermineBasalResult) | undefined
): DynamicISFResult {
    let logOutPut = "";
    let tddReason = "";

    // In case the autosens.min/max limits are reversed:
    const minLimitChris = Math.min(profile.autosens_min, profile.autosens_max);
    const maxLimitChris = Math.max(profile.autosens_min, profile.autosens_max);

    // Turn off when autosens.min = autosens.max
    if (maxLimitChris == minLimitChris || maxLimitChris < 1 || minLimitChris > 1) {
        dynISFenabled = false;
        console.log("Dynamic ISF disabled due to current autosens settings");
    }

    // Dynamic ratios
    const BG = glucose_status.glucose;
    const adjustmentFactor = preferences.adjustmentFactor;
    const adjustmentFactorSigmoid = preferences.adjustmentFactorSigmoid;
    const enable_sigmoid = preferences.sigmoid;
    const currentMinTarget = profileTarget;
    let exerciseSetting = false;
    let log = "";
    let tdd24h_14d_Ratio = 1;
    let basal_ratio_log = "";


    if (average_total_data > 0) {
        tdd24h_14d_Ratio = weightedAverage / average_total_data;
    }

    // respect autosens_max/min for tdd24h_14d_Ratio, used to adjust basal similarly as autosens
    if (tdd24h_14d_Ratio > 1) {
        tdd24h_14d_Ratio = Math.min(tdd24h_14d_Ratio, profile.autosens_max);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
    }
    else if (tdd24h_14d_Ratio < 1) {
        tdd24h_14d_Ratio = Math.max(tdd24h_14d_Ratio, profile.autosens_min);
        tdd24h_14d_Ratio = round(tdd24h_14d_Ratio,2);
    }

    basal_ratio_log = ", Basal ratio: " + tdd24h_14d_Ratio;

    // One of two exercise settings (they share the same purpose)

    if (profile.high_temptarget_raises_sensitivity || profile.exercise_mode) {
    exerciseSetting = true;
    }

    // Turn off Chris' formula when using a temp target >= 118 (6.5 mol/l) and if an exercise setting is enabled.
    if (currentMinTarget >= DYNISF_EXERCISE_THRESHOLD && exerciseSetting) {
        dynISFenabled = false;
        log = "Dynamic ISF temporarily off due to a high temp target/exercising. Current min target: " + currentMinTarget;
    }

    const startLog = ", Dynamic ratios log: ";
    const afLog = ", AF: " + (enable_sigmoid ? adjustmentFactorSigmoid : adjustmentFactor);
    const bgLog = "BG: " + BG + " mg/dl (" + (BG * MGDL_TO_MMOL).toPrecision(2) + " mmol/l)";
    let formula = "";
    let weightLog = "";

    // Insulin curve
    const curve = preferences.curve;
    const ipt = profile.insulinPeakTime;
    const ucpk = preferences.useCustomPeakTime;
    let insulinFactor = INSULIN_FACTOR_CEILING - RAPID_ACTING_ACTIVITY_OFFSET; // default
    let insulinPA = RAPID_ACTING_ACTIVITY_OFFSET; // default (Novorapid/Novolog)

    switch (curve) {
        case "rapid-acting":
            insulinPA = RAPID_ACTING_ACTIVITY_OFFSET;
            break;
        case "ultra-rapid":
            insulinPA = ULTRA_RAPID_ACTIVITY_OFFSET;
            break;
    }

    if (ucpk) {
        insulinFactor = INSULIN_FACTOR_CEILING - ipt;
        console.log("Custom insulinpeakTime set to :" + ipt + ", insulinFactor: " + insulinFactor);
    } else {
        insulinFactor = INSULIN_FACTOR_CEILING - insulinPA;
        console.log("insulinFactor set to : " + insulinFactor);
    }

    // Use weighted TDD average
    const tdd_before: number = tdd;

    if (weightPercentage < 1 && weightedAverage > 1) {
        tdd = weightedAverage;
        console.log("Using weighted TDD average: " + round(tdd,2) + " U, instead of past 24 h (" + round(tdd_before,2) + " U), weight: " + weightPercentage);
        weightLog = ", Weighted TDD: " + round(tdd,2) + " U";
    }

    // Modified Chris Wilson's' formula with added adjustmentFactor for tuning and use of the autosens.ratio:
    // var newRatio = profile.sens * adjustmentFactor * tdd * BG / 277700;
    //
    // New logarithmic formula : var newRatio = profile.sens * adjustmentFactor * tdd * ln(( BG/insulinFactor) + 1 )) / 1800
    //

    let sigmoidLog = ""
    let newRatio: number = undefined!;

    if (dynISFenabled) {
        // Logarithmic
        if (!enable_sigmoid) {
            newRatio = sensitivity * adjustmentFactor * tdd * Math.log(BG/insulinFactor+1) / DYNAMIC_ISF_LOG_DENOMINATOR;
            formula = ", Logarithmic formula";
        }
        // Sigmoid
        else {
            const as_min = minLimitChris;
            const autosens_interval = maxLimitChris - as_min;
            //Blood glucose deviation from set target (the lower BG target) converted to mmol/l to fit current formula.
            const bg_dev = (BG - profileTarget) * MGDL_TO_MMOL;
            // Account for TDD of insulin. Compare last 2 hours with total data (up to 14 days)
            const tdd_factor = tdd24h_14d_Ratio; // weighted average TDD / total data average TDD
            let max_minus_one = maxLimitChris - 1;
            // Avoid division by 0
            if (maxLimitChris == 1) {
                max_minus_one = maxLimitChris + 0.01 - 1;
            }
            //Makes sigmoid factor(y) = 1 when BG deviation(x) = 0.
            const fix_offset = (Math.log10(1/max_minus_one-as_min/max_minus_one) / Math.log10(Math.E));
            //Exponent used in sigmoid formula
            const exponent = bg_dev * adjustmentFactorSigmoid * tdd_factor + fix_offset;
            // The sigmoid function
            const sigmoid_factor = autosens_interval / (1 + Math.exp(-exponent)) + as_min;
            newRatio = sigmoid_factor;
            formula = ", Sigmoid function";
        }
    }

    let dynamicISFLog = "";
    let limitLog = "";

    if (dynISFenabled && tdd > 0) {

        dynamicISFLog = ", Dynamic ISF: On";

        // Respect autosens.max and autosens.min limitLogs
        if (newRatio > maxLimitChris) {
            log = ", Dynamic ISF limited by autosens_max setting: " + maxLimitChris + " (" +  round(newRatio,2) + "), ";
            limitLog = ", Autosens/Dynamic Limit: " + maxLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = maxLimitChris;
        } else if (newRatio < minLimitChris) {
            log = ", Dynamic ISF limited by autosens_min setting: " + minLimitChris + " (" +  round(newRatio,2) + "). ";
            limitLog = ", Autosens/Dynamic Limit: " + minLimitChris + " (" +  round(newRatio,2) + ")";
            newRatio = minLimitChris;
        }

        const isf = sensitivity / newRatio;

         // Set the new ratio
         autosens_data.ratio = newRatio;

        sigmoidLog = ". Using Sigmoid function, the autosens ratio has been adjusted with sigmoid factor to: " + round(autosens_data.ratio, 2) + ". New ISF = " + round(isf, 2) + " mg/dl (" + round(MGDL_TO_MMOL * isf, 2) + " (mmol/l).";

        if (!enable_sigmoid) {
            log += ", Dynamic autosens.ratio set to " + round(newRatio,2) + " with ISF: " + isf.toPrecision(3) + " mg/dl/U (" + (isf * MGDL_TO_MMOL).toPrecision(3) + " mmol/l/U)";
        } else { log += sigmoidLog }


        logOutPut += startLog + bgLog + afLog + formula + log + dynamicISFLog + weightLog;

    } else { logOutPut += startLog + "Dynamic Settings disabled"; }

    console.log(logOutPut);

    if (!dynISFenabled) {
        tddReason += "";
    } else if (dynISFenabled && profile.tddAdjBasal) {
        tddReason += dynamicISFLog + formula + limitLog + afLog + basal_ratio_log;
    }
    else if (dynISFenabled && !profile.tddAdjBasal) { tddReason += dynamicISFLog + formula + limitLog + afLog; }

    if (DEFAULT_SMB_DELIVERY_RATIO !== profile.smb_delivery_ratio) {
        tddReason += ", SMB Ratio: " + Math.min(profile.smb_delivery_ratio!, 1);
    }

    // Not confident but something like this in iAPS v3.0.3
    if ((middleWare as unknown) !== "" && (middleWare as unknown) !== "Nothing changed"){
        tddReason += ", Middleware: " + middleWare;
    }

    return { dynISFenabled, tdd, tddReason, newRatio, insulinFactor, adjustmentFactor, enable_sigmoid, tdd24h_14d_Ratio };
}

interface CGMValidationResult {
    bg: number;
    noise: number | undefined;
    tick: number | string;
    minDelta: number;
    minAvgDelta: number;
    maxDelta: number;
    minAgo: number;
    bgTime: Date;
    deliverAt: Date;
    profile_current_basal: number;
    basal: number;
    reason: string | undefined;
}

function validateCGMData(
    glucose_status: GlucoseStatus,
    profile: Profile,
    systemTime: Date,
    overrideFactor: number,
    currenttemp: CurrentTemp,
    useOverride: boolean,
    overrideDuration: number
): { earlyReturn: DetermineBasalResult } | CGMValidationResult {
    const result = {} as DetermineBasalResult;
    const deliverAt = new Date(systemTime);

    if (profile === undefined || profile.current_basal === undefined) {
        result.error ='Error: could not get current basal rate';
        return { earlyReturn: result };
    }
    const profile_current_basal = round_basal(profile.current_basal, profile) * overrideFactor;
    const basal = profile_current_basal;

    // Print Current Override factor, if any
    if (useOverride) {
        if (overrideDuration == 0) {
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Duration: " + "Enabled indefinitely");
        } else
            console.log("Profile Override is active. Override " + round(overrideFactor * 100, 0) + "%. Override Expires in: " + overrideDuration + " min.");
    }

    const bgTime = new Date(glucose_status.date!);
    const minAgo = round( (systemTime.getTime() - bgTime.getTime()) / MS_PER_MINUTE ,1);

    const bg = glucose_status.glucose;
    const noise = glucose_status.noise;

// Prep various delta variables.
    let tick: number | string;

    if (glucose_status.delta > -0.5) {
        tick = "+" + round(glucose_status.delta,0);
    } else {
        tick = round(glucose_status.delta,0);
    }
    //var minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    const minDelta = Math.min(glucose_status.delta, glucose_status.short_avgdelta);
    const minAvgDelta = Math.min(glucose_status.short_avgdelta, glucose_status.long_avgdelta);
    const maxDelta = Math.max(glucose_status.delta, glucose_status.short_avgdelta, glucose_status.long_avgdelta);


// Cancel high temps (and replace with neutral) or shorten long zero temps for various error conditions

    // 38 is an xDrip error state that usually indicates sensor failure
    // all other BG values between 11 and 37 mg/dL reflect non-error-code BG values, so we should zero temp for those
// First, print out different explanations for each different error condition
    if (bg <= BG_ERROR_CEILING || bg === XDRIP_ERROR_CODE || noise! >= CGM_NOISE_LEVEL_MEDIUM) {  //Dexcom is in ??? mode or calibrating, or xDrip reports high noise
        result.reason = "CGM is calibrating, in ??? state, or noise is high";
    }
    if (bg > BG_UNCHANGED_FLOOR && glucose_status.delta == 0 && glucose_status.short_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucose_status.short_avgdelta < DELTA_UNCHANGED_THRESHOLD && glucose_status.long_avgdelta > -DELTA_UNCHANGED_THRESHOLD && glucose_status.long_avgdelta < DELTA_UNCHANGED_THRESHOLD) {
        if (glucose_status.device == "fakecgm") {
            // BUG: passes `2` instead of `profile` to convert_bg — wrong unit conversion in console output.
            console.error("CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile)+ ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta, 2 as unknown as Profile) + " mg/dL ~45m change");
            console.error("Simulator mode detected (" + glucose_status.device + "): continuing anyway");
        }
    }

    if (minAgo > MAX_BG_DATA_AGE_MINUTES || minAgo < -MAX_BG_FUTURE_MINUTES) { // Dexcom data is too old, or way in the future
        result.reason = "If current system time " + systemTime + " is correct, then BG data is too old. The last BG data was read "+minAgo+"m ago at "+bgTime;

        // if BG is too old/noisy, or is completely unchanging, cancel any high temps and shorten any long zero temps
    } else if ( glucose_status.short_avgdelta === 0 && glucose_status.long_avgdelta === 0 ) {
        if ( glucose_status.last_cal && glucose_status.last_cal < RECENT_CAL_THRESHOLD ) {
            result.reason = "CGM was just calibrated";
        } else {
            result.reason = "CGM data is unchanged (" + convert_bg(bg,profile) + "+" + convert_bg(glucose_status.delta,profile) + ") for 5m w/ " + convert_bg(glucose_status.short_avgdelta,profile) + " mg/dL ~15m change & " + convert_bg(glucose_status.long_avgdelta,profile) + " mg/dL ~45m change";
        }
    }

    if (bg <= BG_ERROR_CEILING || bg === XDRIP_ERROR_CODE || noise! >= CGM_NOISE_LEVEL_MEDIUM || minAgo > MAX_BG_DATA_AGE_MINUTES || minAgo < -MAX_BG_FUTURE_MINUTES) {
        if (currenttemp.rate >= basal) { // high temp is running
            result.reason += ". Replacing high temp basal of "+currenttemp.rate+" with neutral temp of "+basal;
            result.deliverAt = deliverAt as unknown as string;
            result.temp = 'absolute';
            result.duration = TEMP_BASAL_DURATION_MINUTES;
            result.rate = basal;
            return { earlyReturn: result };
            // don't use setTempBasal(), as it has logic that allows <120% high temps to continue running
            //return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        } else if ( currenttemp.rate === 0 && currenttemp.duration > TEMP_BASAL_DURATION_MINUTES ) { //shorten long zero temps to 30m
            result.reason += ". Shortening " + currenttemp.duration + "m long zero temp to 30m. ";
            result.deliverAt = deliverAt as unknown as string;
            result.temp = 'absolute';
            result.duration = TEMP_BASAL_DURATION_MINUTES;
            result.rate = 0;
            return { earlyReturn: result };
            // don't use setTempBasal(), as it has logic that allows long zero temps to continue running
            //return tempBasalFunctions.setTempBasal(0, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        } else { //do nothing.
            result.reason += ". Temp " + currenttemp.rate + " <= current basal " + basal + "U/hr; doing nothing. ";
            return { earlyReturn: result };
        }
    }

    return { bg, noise, tick, minDelta, minAvgDelta, maxDelta, minAgo, bgTime, deliverAt, profile_current_basal, basal, reason: result.reason };
}

interface SensitivityAndTargetsResult {
    max_iob: number;
    target_bg: number;
    min_bg: number;
    max_bg: number;
    high_bg: number;
    sensitivityRatio: number;
    basal: number;
    threshold: number;
    adjustedSens: number;
    isfreason: string;
    targetLog: number | string;
}

function configureSensitivityAndTargets(
    glucose_status: GlucoseStatus,
    profile: Profile,
    autosens_data: AutosensData,
    profileTarget: number,
    overrideTarget: number,
    bg: number,
    dynISFenabled: boolean,
    newRatio: number,
    tdd24h_14d_Ratio: number,
    overrideFactor: number,
    profile_current_basal: number,
    tdd_before: number,
    weightedAverage: number,
    average_total_data: number,
    weightPercentage: number,
    sensitivity: number,
    carbRatio: number,
    basal: number,
    cgmReason: string | undefined
): { earlyReturn: DetermineBasalResult } | SensitivityAndTargetsResult {
// Get configured target, and return if unable to do so.
// This should occur after checking that we're not in one of the CGM-data-related error conditions handled above,
// and before using target_bg to adjust sensitivityRatio below.
    const max_iob = profile.max_iob; // maximum amount of non-bolus IOB OpenAPS will ever deliver

    // if min and max are set, then set target to their average
    let target_bg: number = undefined!;
    let min_bg: number = undefined!;
    let max_bg: number = undefined!;
    let new_target_bg: number = undefined!;
    let high_bg: number = undefined!;

    if (profileTarget !== undefined) {
            min_bg = profileTarget;
    }
    if (profile.max_bg !== undefined) {
            max_bg = profileTarget;
    }
    if (profile.enableSMB_high_bg_target !== undefined) {
        high_bg = profile.enableSMB_high_bg_target;
    }
    if (profileTarget !== undefined) {
        target_bg = profileTarget;

    } else {
        const result = {} as DetermineBasalResult;
        if (cgmReason) {
            result.reason = cgmReason;
        }
        result.error ='Error: could not determine target_bg. ';
        return { earlyReturn: result };
    }


// Calculate sensitivityRatio based on temp targets, if applicable, or using the value calculated by autosens
//    var sensitivityRatio;
    const high_temptarget_raises_sensitivity = profile.exercise_mode || profile.high_temptarget_raises_sensitivity;
    const normalTarget = EXERCISE_NORMAL_TARGET; // evaluate high/low temptarget against 100, not scheduled target (which might change)
    let halfBasalTarget = EXERCISE_HALF_BASAL_TARGET;  // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
    // 80 mg/dL with low_temptarget_lowers_sensitivity would give 1.5x basal, but is limitLoged to autosens_max (1.2x by default)
    //if ( profile.half_basal_exercise_target ) {
    halfBasalTarget = profile.half_basal_exercise_target!;
    //}

    let sensitivityRatio: number = undefined!;
    if ( high_temptarget_raises_sensitivity && profile.temptargetSet && target_bg > normalTarget ||
        profile.low_temptarget_lowers_sensitivity && profile.temptargetSet && target_bg < normalTarget ) {
        // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
        // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
        //sensitivityRatio = 2/(2+(target_bg-normalTarget)/40);
        const c = halfBasalTarget - normalTarget;
        // getting multiplication less or equal to 0 means that we have a really low target with a really low halfBasalTarget
        // with low TT and lowTTlowersSensitivity we need autosens_max as a value
        // we use multiplication instead of the division to avoid "division by zero error"
        if (c * (c + target_bg-normalTarget) <= 0.0) {
          sensitivityRatio = profile.autosens_max;
        }
        else {
          sensitivityRatio = c/(c+target_bg-normalTarget);
        }
        // limit sensitivityRatio to profile.autosens_max (1.2x by default)
        sensitivityRatio = Math.min(sensitivityRatio, profile.autosens_max);
        sensitivityRatio = round(sensitivityRatio,2);
        process.stderr.write("Sensitivity ratio set to "+sensitivityRatio+" based on temp target of "+target_bg+"; ");
    }
    else if (autosens_data !== undefined && autosens_data) {
        sensitivityRatio = autosens_data.ratio;

        // Override Profile.Target
    if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== profile.min_bg && !profile.temptargetSet) {
        target_bg = overrideTarget;
        console.log("Current Override Profile Target: " + convert_bg(overrideTarget, profile) + " " + profile.out_units);
    }
        process.stderr.write("Autosens ratio: "+sensitivityRatio+"; ");
    }

    // Increase the dynamic ratio when using a low temp target
    if (profile.temptargetSet && target_bg < normalTarget && dynISFenabled && bg >= target_bg) {
        if (sensitivityRatio < newRatio) {
            autosens_data.ratio = newRatio * (normalTarget/target_bg);
            //Use autosesns.max limit
            autosens_data.ratio = Math.min(autosens_data.ratio, profile.autosens_max);
            sensitivityRatio = round(autosens_data.ratio, 2);
            console.log("Dynamic ratio increased from " + round(newRatio, 2) + " to " + round(autosens_data.ratio,2) + " due to a low temp target (" + target_bg + ").");
        }
    }

    if (sensitivityRatio && !dynISFenabled) { // Only enable adjustment of basal by sensitivityRatio when not using dISF
        basal = profile.current_basal * overrideFactor * sensitivityRatio;
        basal = round_basal(basal, profile);
        if (basal !== profile_current_basal) {
            process.stderr.write("Adjusting basal from "+profile_current_basal+" to "+basal+"; ");
        } else {
            process.stderr.write("Basal unchanged: "+basal+"; ");
        }
    }

    else if (dynISFenabled && profile.tddAdjBasal) {
        basal = profile.current_basal * tdd24h_14d_Ratio * overrideFactor;
        basal = round_basal(basal, profile);
        if (average_total_data > 0) {
            process.stderr.write("TDD-adjustment of basals activated, using tdd24h_14d_Ratio " + round(tdd24h_14d_Ratio,2) + ", TDD 24h = " + round(tdd_before,2) + "U, Weighted average TDD = " + round(weightedAverage,2) + "U, (Weight percentage = " + weightPercentage + "), Total data of TDDs (up to 14 days) average = " + round(average_total_data,2) + "U. " );
            if (basal !== profile_current_basal * overrideFactor) {
                process.stderr.write("Adjusting basal from " + profile_current_basal * overrideFactor + " U/h to " + basal + " U/h; ");
            } else { process.stderr.write("Basal unchanged: " + basal + " U/h; "); }
        }
    }

// Conversely, adjust BG target based on autosens ratio if no temp target is running
    // adjust min, max, and target BG for sensitivity, such that 50% increase in ISF raises target from 100 to 120
    if (profile.temptargetSet) {
        //process.stderr.write("Temp Target set, not adjusting with autosens; ");
    } else if (autosens_data !== undefined && autosens_data) {
        if ( profile.sensitivity_raises_target && autosens_data.ratio < 1 || profile.resistance_lowers_target && autosens_data.ratio > 1 ) {
            // with a target of 100, default 0.7-1.2 autosens min/max range would allow a 93-117 target range
            min_bg = round((min_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            max_bg = round((max_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            new_target_bg = round((target_bg - TARGET_BG_PIVOT) / autosens_data.ratio) + TARGET_BG_PIVOT;
            // don't allow target_bg below 80
            new_target_bg = Math.max(MIN_BG_TARGET, new_target_bg);
            if (target_bg === new_target_bg) {
                process.stderr.write("target_bg unchanged: " + convert_bg(new_target_bg, profile) + "; ");
            } else {
                process.stderr.write("target_bg from "+ convert_bg(new_target_bg, profile) + " to " + convert_bg(new_target_bg, profile) + "; ");
            }
            target_bg = new_target_bg;
        }
    }

    // Display if differing in enacted box
    let targetLog: number | string = convert_bg(target_bg, profile);
    if  (target_bg != profileTarget) {
        if (overrideTarget !== 0 && overrideTarget !== OVERRIDE_TARGET_SENTINEL && overrideTarget !== target_bg) {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(overrideTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        } else {
            targetLog = convert_bg(profileTarget, profile) + "\u2192" + convert_bg(target_bg, profile);
        }
    }

    // Raise target for noisy / raw CGM data.
    let adjustedMinBG = MAX_BG_TARGET;
    let adjustedTargetBG = MAX_BG_TARGET;
    let adjustedMaxBG = MAX_BG_TARGET;
    if (glucose_status.noise! >= CGM_NOISE_LEVEL_NOISY) {
        // increase target at least 10% (default 30%) for raw / noisy data
        const noisyCGMTargetMultiplier = Math.max( MIN_NOISY_TARGET_MULTIPLIER, profile.noisyCGMTargetMultiplier! );
        // don't allow maxRaw above 250
        const maxRaw = Math.min( MAX_RAW_BG, profile.maxRaw! );
        adjustedMinBG = round(Math.min(MAX_BG_TARGET, min_bg * noisyCGMTargetMultiplier ));
        adjustedTargetBG = round(Math.min(MAX_BG_TARGET, target_bg * noisyCGMTargetMultiplier ));
        adjustedMaxBG = round(Math.min(MAX_BG_TARGET, max_bg * noisyCGMTargetMultiplier ));
        process.stderr.write("Raising target_bg for noisy / raw CGM data, from " + convert_bg(new_target_bg, profile) + " to " + convert_bg(adjustedTargetBG, profile) + "; ");
        min_bg = adjustedMinBG;
        target_bg = adjustedTargetBG;
        max_bg = adjustedMaxBG;
    }

    // min_bg thresholds: 80->60, 90->65, 100->70, 110->75, 120->80
    const threshold = min_bg - THRESHOLD_FACTOR*(min_bg-THRESHOLD_BG_OFFSET);
    // Set threshold to the user's setting, as long as it's between 60-120 and above the default calculated threshold
    const thresholdFinal = Math.min(Math.max(profile.threshold_setting!, threshold, MIN_THRESHOLD_BG), MAX_THRESHOLD_BG);
    console.error(`Threshold set to ${convert_bg(thresholdFinal, profile)}`);

// Adjust ISF based on sensitivityRatio
    let isfreason = ""
    const profile_sens = round(sensitivity,1);
    let adjustedSens = sensitivity;
    if (autosens_data !== undefined && autosens_data) {
        adjustedSens = sensitivity / sensitivityRatio;
        adjustedSens = round(adjustedSens, 1);
        if (adjustedSens !== sensitivity) {
            process.stderr.write("ISF from "+ convert_bg(sensitivity,profile) +" to " + convert_bg(adjustedSens,profile));
        } else {
            process.stderr.write("ISF unchanged: "+ convert_bg(adjustedSens,profile));
        }
        //process.stderr.write(" (autosens ratio "+sensitivityRatio+")");
        isfreason += "Autosens ratio: " + round(sensitivityRatio, 2) + ", ISF: " + convert_bg(sensitivity,profile) + "\u2192" + convert_bg(adjustedSens,profile);

    }
    console.error("CR:" + carbRatio);

    return { max_iob, target_bg, min_bg, max_bg, high_bg, sensitivityRatio, basal, threshold: thresholdFinal, adjustedSens, isfreason, targetLog };
}

interface CarbAbsorptionResult {
    carbImpact: number;
    carbImpactDuration: number;
    uamCarbImpact: number;
    carbSensFactor: number;
    remainingCATime: number;
    remainingCIpeak: number;
    slopeFromDeviations: number;
}

function calculateCarbAbsorption(
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
    console.error("profile.sens:" + convert_bg(sensitivity,profile) + ", sens:" + convert_bg(adjustedSens,profile) + ", CSF:" + round(carbSensFactor,1));

    const maxCarbAbsorptionRate = DEFAULT_MAX_CARB_ABSORPTION_RATE; // g/h; maximum rate to assume carbs will absorb if no CI observed
    // limitLog Carb Impact to maxCarbAbsorptionRate * carbSensFactor in mg/dL per 5m
    const maxCI = round(maxCarbAbsorptionRate*carbSensFactor*PRED_INTERVAL_MINUTES/MINUTES_PER_HOUR,1);
    if (carbImpact > maxCI) {
        console.error("Limiting carb impact from " + carbImpact + " to " + maxCI + "mg/dL/5m (" + maxCarbAbsorptionRate + "g/h)");
        carbImpact = maxCI;
    }
    let remainingCATimeMin = DEFAULT_REMAINING_CA_TIME_MIN_HOURS; // h; minimum duration of expected not-yet-observed carb absorption
    // adjust remainingCATime (instead of CR) for autosens if sensitivityRatio defined
    if (sensitivityRatio) {
        remainingCATimeMin = remainingCATimeMin / sensitivityRatio;
    }
    // 20 g/h means that anything <= 60g will get a remainingCATimeMin, 80g will get 4h, and 120g 6h
    // when actual absorption ramps up it will take over from remainingCATime
    const assumedCarbAbsorptionRate = DEFAULT_ASSUMED_CARB_ABSORPTION_RATE; // g/h; maximum rate to assume carbs will absorb if no CI observed
    let remainingCATime = remainingCATimeMin;
    if (meal_data.carbs) {
        // if carbs * assumedCarbAbsorptionRate > remainingCATimeMin, raise it
        // so <= 90g is assumed to take 3h, and 120g=4h
        remainingCATimeMin = Math.max(remainingCATimeMin, meal_data.mealCOB/assumedCarbAbsorptionRate);
        const lastCarbAge = round(( new Date(systemTime).getTime() - meal_data.lastCarbTime! ) / MS_PER_MINUTE);
        //console.error(meal_data.lastCarbTime, lastCarbAge);

        const fractionCOBAbsorbed = ( meal_data.carbs - meal_data.mealCOB ) / meal_data.carbs;
        // if the lastCarbTime was 1h ago, increase remainingCATime by 1.5 hours
        remainingCATime = remainingCATimeMin + CARB_TIME_EXTENSION_FACTOR * lastCarbAge/MINUTES_PER_HOUR;
        remainingCATime = round(remainingCATime,1);
        //console.error(fractionCOBAbsorbed, remainingCATimeAdjustment, remainingCATime)
        console.error("Last carbs " + lastCarbAge + " minutes ago; remainingCATime:" + remainingCATime + "hours; " + round(fractionCOBAbsorbed*100, 1) + "% carbs absorbed");
    }

    // calculate the number of carbs absorbed over remainingCATime hours at current CI
    // CI (mg/dL/5m) * (5m)/5 (m) * 60 (min/hr) * 4 (h) / 2 (linear decay factor) = total carb impact (mg/dL)
    const totalCI = Math.max(0, carbImpact / PRED_INTERVAL_MINUTES * MINUTES_PER_HOUR * remainingCATime / LINEAR_DECAY_FACTOR);
    // totalCI (mg/dL) / CSF (mg/dL/g) = total carbs absorbed (g)
    const totalCA = totalCI / carbSensFactor;
    let remainingCarbsCap = DEFAULT_REMAINING_CARBS_CAP; // default to 90
    let remainingCarbsFraction = 1;
    if (profile.remainingCarbsCap) { remainingCarbsCap = Math.min(DEFAULT_REMAINING_CARBS_CAP,profile.remainingCarbsCap); }
    if (profile.remainingCarbsFraction) { remainingCarbsFraction = Math.min(1,profile.remainingCarbsFraction); }
    const remainingCarbsIgnore = 1 - remainingCarbsFraction;
    let remainingCarbs = Math.max(0, meal_data.mealCOB - totalCA - meal_data.carbs*remainingCarbsIgnore);
    remainingCarbs = Math.min(remainingCarbsCap,remainingCarbs);
    // assume remainingCarbs will absorb in a /\ shaped bilinear curve
    // peaking at remainingCATime / 2 and ending at remainingCATime hours
    // area of the /\ triangle is the same as a remainingCIpeak-height rectangle out to remainingCATime/2
    // remainingCIpeak (mg/dL/5m) = remainingCarbs (g) * CSF (mg/dL/g) * 5 (m/5m) * 1h/60m / (remainingCATime/2) (h)
    const remainingCIpeak = remainingCarbs * carbSensFactor * PRED_INTERVAL_MINUTES / MINUTES_PER_HOUR / (remainingCATime/LINEAR_DECAY_FACTOR);
    //console.error(profile.min_5m_carbimpact,carbImpact,totalCI,totalCA,remainingCarbs,remainingCI,remainingCATime);

    // calculate peak deviation in last hour, and slope from that to current deviation
    const slopeFromMaxDeviation = round(meal_data.slopeFromMaxDeviation,2);
    // calculate lowest deviation in last hour, and slope from that to current deviation
    const slopeFromMinDeviation = round(meal_data.slopeFromMinDeviation,2);
    // assume deviations will drop back down at least at 1/3 the rate they ramped up
    const slopeFromDeviations = Math.min(slopeFromMaxDeviation,-slopeFromMinDeviation/SLOPE_DAMPENING_DIVISOR);
    //console.error(slopeFromMaxDeviation);

    //5m data points = g * (1U/10g) * (40mg/dL/1U) / (mg/dL/5m)
    // duration (in 5m data points) = COB (g) * CSF (mg/dL/g) / carbImpact (mg/dL/5m)
    // limitLog carbImpactDuration to remainingCATime hours: the reset goes to remainingCI
    if (carbImpact === 0) {
        // avoid divide by zero
        carbImpactDuration = 0;
    } else { carbImpactDuration = Math.min(remainingCATime*MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES/LINEAR_DECAY_FACTOR,Math.max(0, meal_data.mealCOB * carbSensFactor / carbImpact )); }

    // duration (hours) = duration (5m) * 5 / 60 * 2 (to account for linear decay)
    console.error("Carb Impact:" + carbImpact + "mg/dL per 5m; CI Duration:" + round(carbImpactDuration*PRED_INTERVAL_MINUTES/MINUTES_PER_HOUR*LINEAR_DECAY_FACTOR,1) + "hours; remaining CI (" + remainingCATime/LINEAR_DECAY_FACTOR + "h peak):" + round(remainingCIpeak,1) + "mg/dL per 5m");

    return { carbImpact, carbImpactDuration, uamCarbImpact, carbSensFactor, remainingCATime, remainingCIpeak, slopeFromDeviations };
}

/** Predicted BG arrays for each scenario. Keys are part of the external API consumed by the Trio iOS app. */
interface PredBGs {
    /** Predicted BG based on insulin-on-board decay */
    IOB: number[];
    /** Zero Temp: predicted BG if all insulin delivery were suspended */
    ZT: number[];
    /** Predicted BG accounting for carbs-on-board absorption */
    COB?: number[];
    /** Unannounced Meal: predicted BG accounting for detected but unannounced carb absorption */
    UAM?: number[];
}

interface BGPredictionResult {
    eventualBG: number;
    minPredBG: number;
    minGuardBG: number;
    lastIOBpredBG: number;
    lastCOBpredBG: number;
    lastUAMpredBG: number;
    maxCOBPredBG: number;
    minIOBPredBG: number;
    IOBpredBGs: number[];
    COBpredBGs: number[];
    predBGs: PredBGs;
}

function generateBGPredictions(
    iobArray: IOBData[],
    eventualBG: number,
    naive_eventualBG: number,
    bg: number,
    adjustedSens: number,
    carbImpact: number,
    carbImpactDuration: number,
    uamCarbImpact: number,
    remainingCATime: number,
    remainingCIpeak: number,
    slopeFromDeviations: number,
    dynISFenabled: boolean,
    enable_sigmoid: boolean,
    tdd: number,
    adjustmentFactor: number,
    insulinFactor: number,
    enableUAM: boolean | undefined,
    target_bg: number,
    threshold: number,
    meal_data: MealData,
    profile: Profile
): BGPredictionResult {
// Initialize and calculate variables used for predicting BGs
    const COBpredBGs: number[] = [];
    const IOBpredBGs: number[] = [];
    const UAMpredBGs: number[] = [];
    const ZTpredBGs: number[] = [];
    COBpredBGs.push(bg);
    IOBpredBGs.push(bg);
    ZTpredBGs.push(bg);
    UAMpredBGs.push(bg);

    let minIOBPredBG = PRED_BG_SENTINEL;
    let minCOBPredBG = PRED_BG_SENTINEL;
    let minUAMPredBG = PRED_BG_SENTINEL;
    //minGuardBG = bg;
    let minCOBGuardBG = PRED_BG_SENTINEL;
    let minUAMGuardBG = PRED_BG_SENTINEL;
    let minIOBGuardBG = PRED_BG_SENTINEL;
    let minZTGuardBG = PRED_BG_SENTINEL;
    let minPredBG: number = undefined!;
    let avgPredBG: number = undefined!;
    let IOBpredBG = eventualBG;
    let maxIOBPredBG = bg;
    let maxCOBPredBG = bg;
    let lastIOBpredBG: number = undefined!;
    let lastCOBpredBG: number = undefined!;
    let lastUAMpredBG: number = undefined!;
    let UAMduration = 0;
    let remainingCItotal = 0;
    const remainingCIs: number[] = [];
    const predCIs: number[] = [];
    let COBpredBG: number = undefined!;
    let UAMpredBG: number = undefined!;
    try {
        iobArray.forEach((iobTick: IOBData) => {
            //console.error(iobTick);
            const predBGI = round(( -iobTick.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
            const predZTBGI = round(( -iobTick.iobWithZeroTemp!.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
            let ZTpredBG = naive_eventualBG;

            // for IOBpredBGs, predicted deviation impact drops linearly from current deviation down to zero
            // over 60 minutes (data points every 5m)
            const predDev = carbImpact * ( 1 - Math.min(1,IOBpredBGs.length/(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES)) );

            // Adding dynamic ISF in predictions for ZT and IOB. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    //IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev; // Adding dynamic ISF in predictions for UAM, ZT and IOB:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + (round(( -iobTick.activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log((Math.max( IOBpredBGs[IOBpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ),2)) + predDev;
                    //var ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI; // Adding dynamic ISF in predictions for UAM, ZT and IOB:
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + (round(( -iobTick.iobWithZeroTemp!.activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log(( Math.max(ZTpredBGs[ZTpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ), 2));
                    console.log("Dynamic ISF (Logarithmic Formula) )adjusted predictions for IOB and ZT: IOBpredBG: " + round(IOBpredBG,2) + " , ZTpredBG: " + round(ZTpredBG,2));
                    break;
                default:
                    IOBpredBG = IOBpredBGs[IOBpredBGs.length-1] + predBGI + predDev;
                    // calculate predBGs with long zero temp without deviations
                    ZTpredBG = ZTpredBGs[ZTpredBGs.length-1] + predZTBGI;
            }

            // for COBpredBGs, predicted carb impact drops linearly from current carb impact down to zero
            // eventually accounting for all carbs (if they can be absorbed over DIA)
            const predCI = Math.max(0, Math.max(0,carbImpact) * ( 1 - COBpredBGs.length/Math.max(carbImpactDuration*LINEAR_DECAY_FACTOR,1) ) );
            // if any carbs aren't absorbed after remainingCATime hours, assume they'll absorb in a /\ shaped
            // bilinear curve peaking at remainingCIpeak at remainingCATime/2 hours (remainingCATime/2*12 * 5m)
            // and ending at remainingCATime h (remainingCATime*12 * 5m intervals)
            const intervals = Math.min( COBpredBGs.length, (remainingCATime*(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES))-COBpredBGs.length );
            const remainingCI = Math.max(0, intervals / (remainingCATime/LINEAR_DECAY_FACTOR*(MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES)) * remainingCIpeak );
            remainingCItotal += predCI+remainingCI;
            remainingCIs.push(round(remainingCI,0));
            predCIs.push(round(predCI,0));
            //process.stderr.write(round(predCI,1)+"+"+round(remainingCI,1)+" ");
            COBpredBG = COBpredBGs[COBpredBGs.length-1] + predBGI + Math.min(0,predDev) + predCI + remainingCI;
            // for UAMpredBGs, predicted carb impact drops at slopeFromDeviations
            // calculate predicted CI from UAM based on slopeFromDeviations
            const predUCIslope = Math.max(0, uamCarbImpact + ( UAMpredBGs.length*slopeFromDeviations ) );
            // if slopeFromDeviations is too flat, predicted deviation impact drops linearly from
            // current deviation down to zero over 3h (data points every 5m)
            const predUCImax = Math.max(0, uamCarbImpact * ( 1 - UAMpredBGs.length/Math.max(UAM_DECAY_HOURS*MINUTES_PER_HOUR/PRED_INTERVAL_MINUTES,1) ) );
            //console.error(predUCIslope, predUCImax);
            // predicted CI from UAM is the lesser of CI based on deviationSlope or DIA
            const predUCI = Math.min(predUCIslope, predUCImax);
            if(predUCI>0) {
                //console.error(UAMpredBGs.length,slopeFromDeviations, predUCI);
                UAMduration=round((UAMpredBGs.length+1)*PRED_INTERVAL_MINUTES/MINUTES_PER_HOUR,1);
            }

            // Adding dynamic ISF in predictions for UAM. Modification from Tim Street's AAPS but with default as off:
            switch(true) {
                case dynISFenabled && !enable_sigmoid:
                    //UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI; // Adding dynamic ISF in predictions for UAM:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + (round(( -iobTick.activity * (DYNAMIC_ISF_LOG_DENOMINATOR / ( tdd * adjustmentFactor * (Math.log(( Math.max(UAMpredBGs[UAMpredBGs.length-1],MIN_VALID_GLUCOSE_MGDL) / insulinFactor ) + 1 ) ) )) * PRED_INTERVAL_MINUTES ),2)) + Math.min(0, predDev) + predUCI;
                    console.log("Dynamic ISF (Logarithmic Formula) adjusted prediction for UAM: UAMpredBG: " + round(UAMpredBG,2));
                    break;
                default:
                    UAMpredBG = UAMpredBGs[UAMpredBGs.length-1] + predBGI + Math.min(0, predDev) + predUCI;
            }
            //console.error(predBGI, predCI, predUCI);
            // truncate all BG predictions at 4 hours
            if ( IOBpredBGs.length < PRED_BG_MAX_LENGTH ) { IOBpredBGs.push(IOBpredBG); }
            if ( COBpredBGs.length < PRED_BG_MAX_LENGTH ) { COBpredBGs.push(COBpredBG); }
            if ( UAMpredBGs.length < PRED_BG_MAX_LENGTH ) { UAMpredBGs.push(UAMpredBG); }
            if ( ZTpredBGs.length < PRED_BG_MAX_LENGTH ) { ZTpredBGs.push(ZTpredBG); }
            // calculate minGuardBGs without a wait from COB, UAM, IOB predBGs
            if ( COBpredBG < minCOBGuardBG ) { minCOBGuardBG = round(COBpredBG); }
            if ( UAMpredBG < minUAMGuardBG ) { minUAMGuardBG = round(UAMpredBG); }
            if ( IOBpredBG < minIOBGuardBG ) { minIOBGuardBG = round(IOBpredBG); }
            if ( ZTpredBG < minZTGuardBG ) { minZTGuardBG = round(ZTpredBG); }

            // set minPredBGs starting when currently-dosed insulin activity will peak
            // look ahead 60m (regardless of insulin type) so as to be less aggressive on slower insulins
            // add 30m to allow for insulin delivery (SMBs or temps)
            const insulinPeakTime = INSULIN_PEAK_WAIT_MINUTES;
            const insulinPeak5m = insulinPeakTime/PRED_INTERVAL_MINUTES;
            //console.error(insulinPeakTime, insulinPeak5m, profile.insulinPeakTime, profile.curve);

            // wait 90m before setting minIOBPredBG
            if ( IOBpredBGs.length > insulinPeak5m && (IOBpredBG < minIOBPredBG) ) { minIOBPredBG = round(IOBpredBG); }
            if ( IOBpredBG > maxIOBPredBG ) { maxIOBPredBG = IOBpredBG; }
            // wait 85-105m before setting COB and 60m for UAM minPredBGs
            if ( (carbImpactDuration || remainingCIpeak > 0) && COBpredBGs.length > insulinPeak5m && (COBpredBG < minCOBPredBG) ) { minCOBPredBG = round(COBpredBG); }
            if ( (carbImpactDuration || remainingCIpeak > 0) && COBpredBG > maxIOBPredBG ) { maxCOBPredBG = COBpredBG; }
            if ( enableUAM && UAMpredBGs.length > MIN_PRED_TRIM_POINTS && (UAMpredBG < minUAMPredBG) ) { minUAMPredBG = round(UAMpredBG); }
        });
        // set eventualBG to include effect of carbs
        //console.error("PredBGs:",JSON.stringify(predBGs));
    } catch (e) {
        console.error("Problem with iobArray.  Optional feature Advanced Meal Assist disabled");
    }
    if (meal_data.mealCOB) {
        console.error("predCIs (mg/dL/5m):" + predCIs.join(" "));
        console.error("remainingCIs:      " + remainingCIs.join(" "));
    }
    const predBGs: PredBGs = {} as PredBGs;
    IOBpredBGs.forEach((p: number, i: number, theArray: number[]) => {
        theArray[i] = round(Math.min(MAX_VALID_GLUCOSE_MGDL+1,Math.max(MIN_VALID_GLUCOSE_MGDL,p)));
    });
    let i;
    for (i=IOBpredBGs.length-1; i > MIN_PRED_TRIM_POINTS; i--) {

        if (IOBpredBGs[i-1] !== IOBpredBGs[i]) { break; }
        else { IOBpredBGs.pop(); }
    }
    predBGs.IOB = IOBpredBGs;
    lastIOBpredBG=round(IOBpredBGs[IOBpredBGs.length-1]);
    ZTpredBGs.forEach((p: number, i: number, theArray: number[]) => {
        theArray[i] = round(Math.min(MAX_VALID_GLUCOSE_MGDL+1,Math.max(MIN_VALID_GLUCOSE_MGDL,p)));
    });
    for (i=ZTpredBGs.length-1; i > MIN_ZT_TRIM_POINTS; i--) {
        // stop displaying ZTpredBGs once they're rising and above target
        if (ZTpredBGs[i-1] >= ZTpredBGs[i] || ZTpredBGs[i] <= target_bg) { break; }
        else { ZTpredBGs.pop(); }
    }
    predBGs.ZT = ZTpredBGs;
    if (meal_data.mealCOB > 0 && ( carbImpact > 0 || remainingCIpeak > 0 )) {
        COBpredBGs.forEach((p: number, i: number, theArray: number[]) => {
            theArray[i] = round(Math.min(COB_PRED_BG_CAP,Math.max(MIN_VALID_GLUCOSE_MGDL,p)));
        });
        for (i=COBpredBGs.length-1; i > MIN_PRED_TRIM_POINTS; i--) {
            if (COBpredBGs[i-1] !== COBpredBGs[i]) { break; }
            else { COBpredBGs.pop(); }
        }
        predBGs.COB = COBpredBGs;
        lastCOBpredBG=round(COBpredBGs[COBpredBGs.length-1]);
        eventualBG = Math.max(eventualBG, round(COBpredBGs[COBpredBGs.length-1]));
        console.error("COBpredBG: " + round(COBpredBGs[COBpredBGs.length-1]) );
    }
    if (carbImpact > 0 || remainingCIpeak > 0) {
        if (enableUAM) {
            UAMpredBGs.forEach((p: number, i: number, theArray: number[]) => {
                theArray[i] = round(Math.min(MAX_VALID_GLUCOSE_MGDL+1,Math.max(MIN_VALID_GLUCOSE_MGDL,p)));
            });
            for (i=UAMpredBGs.length-1; i > MIN_PRED_TRIM_POINTS; i--) {
                if (UAMpredBGs[i-1] !== UAMpredBGs[i]) { break; }
                else { UAMpredBGs.pop(); }
            }
            predBGs.UAM = UAMpredBGs;
            lastUAMpredBG=round(UAMpredBGs[UAMpredBGs.length-1]);
            if (UAMpredBGs[UAMpredBGs.length-1]) {
                eventualBG = Math.max(eventualBG, round(UAMpredBGs[UAMpredBGs.length-1]) );
            }
        }

        // set eventualBG based on COB or UAM predBGs
    }

    console.error("UAM Impact:" + uamCarbImpact + "mg/dL per 5m; UAM Duration:" + UAMduration + "hours");

    minIOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minIOBPredBG);
    minCOBPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minCOBPredBG);
    minUAMPredBG = Math.max(MIN_VALID_GLUCOSE_MGDL,minUAMPredBG);
    minPredBG = round(minIOBPredBG);

    const fractionCarbsLeft = meal_data.mealCOB/meal_data.carbs;
    // if we have COB and UAM is enabled, average both
    if ( minUAMPredBG < PRED_BG_SENTINEL && minCOBPredBG < PRED_BG_SENTINEL ) {
        // weight COBpredBG vs. UAMpredBG based on how many carbs remain as COB
        avgPredBG = round( (1-fractionCarbsLeft)*UAMpredBG + fractionCarbsLeft*COBpredBG );
        // if UAM is disabled, average IOB and COB
    } else if ( minCOBPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + COBpredBG)/2 );
        // if we have UAM but no COB, average IOB and UAM
    } else if ( minUAMPredBG < PRED_BG_SENTINEL ) {
        avgPredBG = round( (IOBpredBG + UAMpredBG)/2 );
    } else {
        avgPredBG = round( IOBpredBG );
    }
    // if avgPredBG is below minZTGuardBG, bring it up to that level
    if ( minZTGuardBG > avgPredBG ) {
        avgPredBG = minZTGuardBG;
    }

    // if we have both minCOBGuardBG and minUAMGuardBG, blend according to fractionCarbsLeft
    let minGuardBG: number;
    if ( (carbImpactDuration || remainingCIpeak > 0) ) {
        if ( enableUAM ) {
            minGuardBG = fractionCarbsLeft*minCOBGuardBG + (1-fractionCarbsLeft)*minUAMGuardBG;
        } else {
            minGuardBG = minCOBGuardBG;
        }
    } else if ( enableUAM ) {
        minGuardBG = minUAMGuardBG;
    } else {
        minGuardBG = minIOBGuardBG;
    }
    minGuardBG = round(minGuardBG);
    //console.error(minCOBGuardBG, minUAMGuardBG, minIOBGuardBG, minGuardBG);

    let minZTUAMPredBG = minUAMPredBG;
    // if minZTGuardBG is below threshold, bring down any super-high minUAMPredBG by averaging
    // this helps prevent UAM from giving too much insulin in case absorption falls off suddenly
    if ( minZTGuardBG < threshold ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    // if minZTGuardBG is between threshold and target, blend in the averaging
    } else if ( minZTGuardBG < target_bg ) {
        // target 100, threshold 70, minZTGuardBG 85 gives 50%: (85-70) / (100-70)
        const blendPct = (minZTGuardBG-threshold) / (target_bg-threshold);
        const blendedMinZTGuardBG = minUAMPredBG*blendPct + minZTGuardBG*(1-blendPct);
        minZTUAMPredBG = (minUAMPredBG + blendedMinZTGuardBG) / 2;
        //minZTUAMPredBG = minUAMPredBG - target_bg + minZTGuardBG;
    // if minUAMPredBG is below minZTGuardBG, bring minUAMPredBG up by averaging
    // this allows more insulin if lastUAMPredBG is below target, but minZTGuardBG is still high
    } else if ( minZTGuardBG > minUAMPredBG ) {
        minZTUAMPredBG = (minUAMPredBG + minZTGuardBG) / 2;
    }
    minZTUAMPredBG = round(minZTUAMPredBG);
    //console.error("minUAMPredBG:",minUAMPredBG,"minZTGuardBG:",minZTGuardBG,"minZTUAMPredBG:",minZTUAMPredBG);
    // if any carbs have been entered recently
    if (meal_data.carbs) {

        // if UAM is disabled, use max of minIOBPredBG, minCOBPredBG
        if ( ! enableUAM && minCOBPredBG < PRED_BG_SENTINEL ) {
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG));
        // if we have COB, use minCOBPredBG, or blendedMinPredBG if it's higher
        } else if ( minCOBPredBG < PRED_BG_SENTINEL ) {
            // calculate blendedMinPredBG based on how many carbs remain as COB
            const blendedMinPredBG = fractionCarbsLeft*minCOBPredBG + (1-fractionCarbsLeft)*minZTUAMPredBG;
            // if blendedMinPredBG > minCOBPredBG, use that instead
            minPredBG = round(Math.max(minIOBPredBG, minCOBPredBG, blendedMinPredBG));
        // if carbs have been entered, but have expired, use minUAMPredBG
        } else if ( enableUAM ) {
            minPredBG = minZTUAMPredBG;
        } else {
            minPredBG = minGuardBG;
        }
    // in pure UAM mode, use the higher of minIOBPredBG,minUAMPredBG
    } else if ( enableUAM ) {
        minPredBG = round(Math.max(minIOBPredBG,minZTUAMPredBG));
    }

    // make sure minPredBG isn't higher than avgPredBG
    minPredBG = Math.min( minPredBG, avgPredBG );

// Print summary variables based on predBGs etc.

    process.stderr.write("minPredBG: "+minPredBG+" minIOBPredBG: "+minIOBPredBG+" minZTGuardBG: "+minZTGuardBG);
    if (minCOBPredBG < PRED_BG_SENTINEL) {
        process.stderr.write(" minCOBPredBG: "+minCOBPredBG);
    }
    if (minUAMPredBG < PRED_BG_SENTINEL) {
        process.stderr.write(" minUAMPredBG: "+minUAMPredBG);
    }
    console.error(" avgPredBG:" + avgPredBG + " COB/Carbs:" + meal_data.mealCOB + "/" + meal_data.carbs);
    // But if the COB line falls off a cliff, don't trust UAM too much:
    // use maxCOBPredBG if it's been set and lower than minPredBG
    if ( maxCOBPredBG > bg ) {
        minPredBG = Math.min(minPredBG, maxCOBPredBG);
    }

    return { eventualBG, minPredBG, minGuardBG, lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, maxCOBPredBG, minIOBPredBG, IOBpredBGs, COBpredBGs, predBGs };
}

interface DosingDecisionInputs {
    result: DetermineBasalResult;
    iob_data: IOBData;
    meal_data: MealData;
    profile: Profile;
    glucose_status: GlucoseStatus;
    currenttemp: CurrentTemp;
    tempBasalFunctions: TempBasalFunctions;
    systemTime: Date;
    trio_custom_variables: TrioCustomVariables;
    bg: number;
    eventualBG: number;
    naive_eventualBG: number;
    threshold: number;
    target_bg: number;
    min_bg: number;
    max_bg: number;
    max_iob: number;
    basal: number;
    adjustedSens: number;
    carbRatio: number;
    overrideFactor: number;
    expectedDelta: number;
    minDelta: number;
    maxDelta: number;
    tick: number | string;
    bgImpact: number;
    deviation: number;
    carbImpact: number;
    remainingCIpeak: number;
    carbSensFactor: number;
    minPredBG: number;
    minGuardBG: number;
    lastIOBpredBG: number;
    lastCOBpredBG: number;
    lastUAMpredBG: number;
    minIOBPredBG: number;
    IOBpredBGs: number[];
    COBpredBGs: number[];
    enableSMB: boolean;
    microBolusAllowed: boolean;
    isfreason: string;
    targetLog: number | string;
    tddReason: string;
}

function calculateDosingDecision(inputs: DosingDecisionInputs): DetermineBasalResult {
    const {
        result, iob_data, meal_data, profile, glucose_status, currenttemp,
        tempBasalFunctions, systemTime, trio_custom_variables,
        bg, eventualBG, naive_eventualBG,
        threshold, target_bg, min_bg, max_bg, max_iob,
        basal, adjustedSens, carbRatio, overrideFactor,
        expectedDelta, minDelta, maxDelta, tick,
        bgImpact, deviation,
        carbImpact, remainingCIpeak, carbSensFactor,
        minPredBG, minGuardBG,
        lastIOBpredBG, lastCOBpredBG, lastUAMpredBG,
        minIOBPredBG, IOBpredBGs, COBpredBGs,
        microBolusAllowed,
        isfreason, targetLog, tddReason,
    } = inputs;
    let enableSMB = inputs.enableSMB;
    const { advancedSettings, smbMinutes, uamMinutes } = trio_custom_variables;
    let insulinForManualBolus = 0;

    result.COB=meal_data.mealCOB;
    result.IOB=iob_data.iob;
    result.BGI=convert_bg(bgImpact,profile);
    result.deviation=convert_bg(deviation, profile);
    result.ISF=convert_bg(adjustedSens, profile);
    result.CR=round(carbRatio, 1);
    result.target_bg=convert_bg(target_bg, profile);
    result.current_target=round(target_bg, 0);
    result.reason = isfreason + ", COB: " + result.COB + ", Dev: " + result.deviation + ", BGI: " + result.BGI + ", CR: " + result.CR + ", Target: " + targetLog + ", minPredBG " + convert_bg(minPredBG, profile) + ", minGuardBG " + convert_bg(minGuardBG, profile) + ", IOBpredBG " + convert_bg(lastIOBpredBG, profile);
    if (lastCOBpredBG > 0) {
        result.reason += ", COBpredBG " + convert_bg(lastCOBpredBG, profile);
    }
    if (lastUAMpredBG > 0) {
        result.reason += ", UAMpredBG " + convert_bg(lastUAMpredBG, profile);
    }
    result.reason += tddReason;

    result.reason += "; "; // reason.conclusion started
// Use minGuardBG to prevent overdosing in hypo-risk situations
    // use naive_eventualBG if above 40, but switch to minGuardBG if both eventualBGs hit floor of 39
    let carbsReqBG = naive_eventualBG;
    if ( carbsReqBG < LOW_BG_SAFETY_THRESHOLD ) {
        carbsReqBG = Math.min( minGuardBG, carbsReqBG );
    }
    let bgUndershoot = threshold - carbsReqBG;
    // calculate how long until COB (or IOB) predBGs drop below min_bg
    let minutesAboveMinBG = PRED_HORIZON_MAX_MINUTES;
    let minutesAboveThreshold = PRED_HORIZON_MAX_MINUTES;
    if (meal_data.mealCOB > 0 && ( carbImpact > 0 || remainingCIpeak > 0 )) {
        for (let i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
        for (let i=0; i<COBpredBGs.length; i++) {
            if ( COBpredBGs[i] < threshold ) {
                minutesAboveThreshold = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
    }

    else {
        for (let i=0; i<IOBpredBGs.length; i++) {
            //console.error(IOBpredBGs[i], min_bg);
            if ( IOBpredBGs[i] < min_bg ) {
                minutesAboveMinBG = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
        for (let i=0; i<IOBpredBGs.length; i++) {
            //console.error(IOBpredBGs[i], threshold);
            if ( IOBpredBGs[i] < threshold ) {
                minutesAboveThreshold = PRED_INTERVAL_MINUTES*i;
                break;
            }
        }
    }

    if (enableSMB && minGuardBG < threshold) {
        console.error("minGuardBG " + convert_bg(minGuardBG, profile) + " projected below " + convert_bg(threshold, profile) + " - disabling SMB");
        result.manualBolusErrorString = BOLUS_ERR_GUARD_BELOW_THRESHOLD;
        result.minGuardBG = minGuardBG;
        result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);

        //result.reason += "minGuardBG "+minGuardBG+"<"+threshold+": SMB disabled; ";
        enableSMB = false;
    }
// Disable SMB for sudden rises (often caused by calibrations or activation/deactivation of Dexcom's noise-filtering algorithm)
// Added maxDelta_bg_threshold as a hidden preference and included a cap at 0.4 as a safety limitLog
    const maxDelta_bg_threshold = profile.maxDelta_bg_threshold !== undefined
        ? Math.min(profile.maxDelta_bg_threshold, MAX_DELTA_BG_THRESHOLD_CAP)
        : DEFAULT_MAX_DELTA_BG_THRESHOLD;
    if ( maxDelta > maxDelta_bg_threshold * bg ) {
        console.error("maxDelta " + convert_bg(maxDelta, profile)+ " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - disabling SMB");
        result.reason += "maxDelta " + convert_bg(maxDelta, profile) + " > " + 100 * maxDelta_bg_threshold + "% of BG " + convert_bg(bg, profile) + " - SMB disabled!, ";
        enableSMB = false;
    }

// Calculate carbsReq (carbs required to avoid a hypo)
    console.error("BG projected to remain above " + convert_bg(min_bg, profile) + " for " + minutesAboveMinBG + "minutes");
    if ( minutesAboveThreshold < PRED_HORIZON_MAX_MINUTES || minutesAboveMinBG < MINUTES_ABOVE_MIN_BG_THRESHOLD ) {
        console.error("BG projected to remain above " + convert_bg(threshold,profile) + " for " + minutesAboveThreshold + "minutes");
    }
    // include at least minutesAboveThreshold worth of zero temps in calculating carbsReq
    // always include at least 30m worth of zero temp (carbs to 80, low temp up to target)
    const zeroTempDuration = minutesAboveThreshold;
    // BG undershoot, minus effect of zero temps until hitting min_bg, converted to grams, minus COB
    let zeroTempEffect = profile.current_basal*overrideFactor*adjustedSens*zeroTempDuration/MINUTES_PER_HOUR;
    // don't count the last 25% of COB against carbsReq
    const COBforCarbsReq = Math.max(0, meal_data.mealCOB - COB_DISCOUNT_FRACTION*meal_data.carbs);
    let carbsReq = (bgUndershoot - zeroTempEffect) / carbSensFactor - COBforCarbsReq;
    zeroTempEffect = round(zeroTempEffect);
    carbsReq = round(carbsReq);
    console.error("naive_eventualBG:",naive_eventualBG,"bgUndershoot:",bgUndershoot,"zeroTempDuration:",zeroTempDuration,"zeroTempEffect:",zeroTempEffect,"carbsReq:",carbsReq);
    if ( meal_data.reason == "Could not parse clock data" ) {
        console.error("carbsReq unknown: Could not parse clock data");
    } else if ( carbsReq >= profile.carbsReqThreshold! && minutesAboveThreshold <= CARBS_REQ_WINDOW_MINUTES ) {
        result.carbsReq = carbsReq;
        result.reason += carbsReq + " add'l carbs req w/in " + minutesAboveThreshold + "m; ";
    }

// Begin core dosing logic: check for situations requiring low or high temps, and return appropriate temp after first match

    // don't low glucose suspend if IOB is already super negative and BG is rising faster than predicted
    let worstCaseInsulinReq = 0;
    let durationReq = 0;
    if (bg < threshold && iob_data.iob < -profile.current_basal*overrideFactor*IOB_NEG_CHECK_MINUTES/MINUTES_PER_HOUR && minDelta > 0 && minDelta > expectedDelta) {
        result.reason += "IOB "+iob_data.iob+" < " + round(-profile.current_basal*overrideFactor*IOB_NEG_CHECK_MINUTES/MINUTES_PER_HOUR,2);
        result.reason += " and minDelta " + convert_bg(minDelta, profile) + " > " + "expectedDelta " + convert_bg(expectedDelta, profile) + "; ";
     // predictive low glucose suspend mode: BG is / is projected to be < threshold
    } else if ( bg < threshold || minGuardBG < threshold ) {
        result.reason += "minGuardBG " + convert_bg(minGuardBG, profile) + "<" + convert_bg(threshold, profile);
        bgUndershoot = target_bg - minGuardBG;

        if (minGuardBG < threshold) {
            result.manualBolusErrorString = BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD;
            result.minGuardBG = minGuardBG;
        }
        result.insulinForManualBolus =  round((eventualBG - target_bg) / adjustedSens, 2);

        worstCaseInsulinReq = bgUndershoot / adjustedSens;
        durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal*overrideFactor);
        durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
        // always set a 30-120m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
        durationReq = Math.min(MAX_TEMP_BASAL_DURATION_MINUTES,Math.max(TEMP_BASAL_DURATION_MINUTES,durationReq));
        return tempBasalFunctions.setTempBasal(0, durationReq, profile, result, currenttemp);
    }

    // if not in LGS mode, cancel temps before the top of the hour to reduce beeping/vibration
    // console.error(profile.skip_neutral_temps, (result.deliverAt as unknown as Date).getMinutes());
    if ( profile.skip_neutral_temps && (result.deliverAt as unknown as Date).getMinutes() >= TOP_OF_HOUR_WINDOW_MINUTES ) {
        if (!enableSMB) {
            result.reason += "; Canceling temp at " + (MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()) + "min before turn of the hour to avoid beeping of MDT. SMB are disabled anyways.";
            return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
        } else {
             console.error((MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()) + "min before turn of the hour, but SMB's are enabled - not skipping neutral temps.")
        }
    }

    let insulinReq = 0;
    let rate = basal;
    let insulinScheduled = 0;
    if (eventualBG < min_bg) { // if eventual BG is below target:
        result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " < " + convert_bg(min_bg, profile);
        // if 5m or 30m avg BG is rising faster than expected delta
        if ( minDelta > expectedDelta && minDelta > 0 && !carbsReq ) {
            // if naive_eventualBG < 40, set a 30m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
            if (naive_eventualBG < LOW_BG_SAFETY_THRESHOLD) {
                result.reason += ", naive_eventualBG < 40. ";
                return tempBasalFunctions.setTempBasal(0, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
            if (glucose_status.delta > minDelta) {
                result.reason += ", but Delta " + convert_bg(tick as number, profile) + " > expectedDelta " + convert_bg(expectedDelta, profile);
            } else {
                result.reason += ", but Min. Delta " + minDelta.toFixed(2) + " > Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }

        // calculate 30m low-temp required to get projected BG up to target
        // multiply by 2 to low-temp faster for increased hypo safety
        insulinReq = LOW_TEMP_CORRECTION_FACTOR * Math.min(0, (eventualBG - target_bg) / adjustedSens);
        insulinReq = round( insulinReq , 2);
        // calculate naiveInsulinReq based on naive_eventualBG
        let naiveInsulinReq = Math.min(0, (naive_eventualBG - target_bg) / adjustedSens);
        naiveInsulinReq = round( naiveInsulinReq , 2);
        if (minDelta < 0 && minDelta > expectedDelta) {
            // if we're barely falling, newinsulinReq should be barely negative
            const newinsulinReq = round(( insulinReq * (minDelta / expectedDelta) ), 2);
            //console.error("Increasing insulinReq from " + insulinReq + " to " + newinsulinReq);
            insulinReq = newinsulinReq;
        }
        // rate required to deliver insulinReq less insulin over 30m:
        rate = basal + (LOW_TEMP_CORRECTION_FACTOR * insulinReq);
        rate = round_basal(rate, profile);

        // if required temp < existing temp basal
        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
        // if current temp would deliver a lot (30% of basal) less than the required insulin,
        // by both normal and naive calculations, then raise the rate
        const minInsulinReq = Math.min(insulinReq,naiveInsulinReq);

        console.log("naiveInsulinReq:" + naiveInsulinReq);

        if (insulinScheduled < minInsulinReq - basal*BASAL_SHORTFALL_FRACTION) {
            result.reason += ", " + currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " is a lot less than needed. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
        if (currenttemp.rate !== undefined && (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && rate >= currenttemp.rate * RATE_TOLERANCE_LOW)) {
            result.reason += ", temp " + currenttemp.rate + " ~< req " + rate + "U/hr. ";
            return result;
        }

        else {
            // calculate a long enough zero temp to eventually correct back up to target
            if ( rate <=0 ) {
                bgUndershoot = target_bg - naive_eventualBG;
                worstCaseInsulinReq = bgUndershoot / adjustedSens;
                durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal * overrideFactor);
                if (durationReq < 0) {
                    durationReq = 0;
                // don't set a temp longer than 120 minutes
                } else {
                    durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
                    durationReq = Math.min(MAX_TEMP_BASAL_DURATION_MINUTES,Math.max(0,durationReq));
                }
                //console.error(durationReq);
                if (durationReq > 0) {
                    result.reason += ", setting " + durationReq + "m zero temp. ";
                    return tempBasalFunctions.setTempBasal(rate, durationReq, profile, result, currenttemp);
                }
            }

            else {
                result.reason += ", setting " + rate + "U/hr. ";
            }
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
    }

    // if eventual BG is above min_bg but BG is falling faster than expected Delta
    if (minDelta < expectedDelta) {

        result.minDelta = minDelta;
        result.expectedDelta = expectedDelta;

        //Describe how the glucose is changing
        if (expectedDelta - minDelta >= DELTA_SIGNIFICANCE_THRESHOLD || (expectedDelta + (-1 * minDelta) >= DELTA_SIGNIFICANCE_THRESHOLD)) {
            if (minDelta >= 0 && expectedDelta > 0) {
                result.manualBolusErrorString = BOLUS_ERR_RISING_SLOWER;
            }
            else if ((minDelta < 0 && expectedDelta <= 0) ||  (minDelta < 0 && expectedDelta >= 0)) {
                result.manualBolusErrorString = BOLUS_ERR_FALLING_OR_MIXED;
            }
            else {
                result.manualBolusErrorString = BOLUS_ERR_OTHER_DELTA;
            }
        }

        result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);

        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB)) {
            if (glucose_status.delta < minDelta) {
                result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Delta " + convert_bg(tick as number, profile) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            } else {
                result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " > " + convert_bg(min_bg, profile) + " but Min. Delta " + minDelta.toFixed(2) + " < Exp. Delta " + convert_bg(expectedDelta, profile);
            }
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }
    }
    // eventualBG or minPredBG is below max_bg
    if (Math.min(eventualBG,minPredBG) < max_bg) {
        if (minPredBG < min_bg && eventualBG > min_bg) {
            result.manualBolusErrorString = BOLUS_ERR_MIN_PRED_BELOW_MIN;
            result.insulinForManualBolus = round((result.eventualBG! - result.target_bg!) / adjustedSens, 2);
        }

        // Moving this out of the if condition in L1429, so that minPredBG is becomes always available in result object (aka Trio's determination)
        result.minPredBG = minPredBG;

        // if in SMB mode, don't cancel SMB zero temp
        if (! (microBolusAllowed && enableSMB )) {
            result.reason += convert_bg(eventualBG, profile)+ "-" + convert_bg(minPredBG, profile) + " in range: no temp required";
            if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
                result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
                return result;
            } else {
                result.reason += "; setting current basal of " + basal + " as temp. ";
                return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
            }
        }
    }

    // eventual BG is at/above target
    // if iob is over max, just cancel any temps
    if ( eventualBG >= max_bg ) {
        result.reason += "Eventual BG " + convert_bg(eventualBG, profile) + " >= " +  convert_bg(max_bg, profile) + ", ";
        if (eventualBG > max_bg) {
        result.insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
        }
    }
    if (iob_data.iob > max_iob) {
        result.reason += "IOB " + round(iob_data.iob,2) + " > max_iob " + max_iob;
        if (currenttemp.duration > TEMP_ACTIVE_DURATION_MINUTES && (round_basal(basal, profile) === round_basal(currenttemp.rate, profile))) {
            result.reason += ", temp " + currenttemp.rate + " ~ req " + basal + "U/hr. ";
            return result;
        } else {
            result.reason += "; setting current basal of " + basal + " as temp. ";
            return tempBasalFunctions.setTempBasal(basal, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }
    }

    else { // otherwise, calculate 30m high-temp required to get projected BG down to target
        // insulinReq is the additional insulin required to get minPredBG down to target_bg
        //console.error(minPredBG,eventualBG);
        insulinReq = round( (Math.min(minPredBG,eventualBG) - target_bg) / adjustedSens, 2);
        insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
        // if that would put us over max_iob, then reduce accordingly
        if (insulinReq > max_iob-iob_data.iob) {
            // BUG: operator precedence — ("text" + max_iob as number) - iob_data.iob evaluates as NaN. Console output only.
            console.error(("SMB limited by maxIOB: " + max_iob as unknown as number)-iob_data.iob + " (. insulinReq: " + insulinReq + " U)");
            result.reason += "max_iob " + max_iob + ", ";
            insulinReq = max_iob-iob_data.iob;
        } else { console.error("SMB not limited by maxIOB ( insulinReq: " + insulinReq + " U).");}

        if (insulinForManualBolus > max_iob-iob_data.iob) {
            // BUG: operator precedence — ("text" + max_iob as number) - iob_data.iob evaluates as NaN. Console output only.
            console.error(("Ev. Bolus limited by maxIOB: " + max_iob as unknown as number)-iob_data.iob + " (. insulinForManualBolus: " + insulinForManualBolus + " U)");
            result.reason += "max_iob " + max_iob + ", ";
        } else { console.error("Ev. Bolus would not be limited by maxIOB ( insulinForManualBolus: " + insulinForManualBolus + " U).");}

        // rate required to deliver insulinReq more insulin over 30m:
        rate = basal + (LOW_TEMP_CORRECTION_FACTOR * insulinReq);
        rate = round_basal(rate, profile);
        insulinReq = round(insulinReq,3);
        result.insulinReq = insulinReq;
        //console.error(iob_data.lastBolusTime);
        // minutes since last bolus
        const lastBolusAge = round(( new Date(systemTime).getTime() - iob_data.lastBolusTime! ) / MS_PER_MINUTE,1);

        //console.error(lastBolusAge);
        //console.error(profile.temptargetSet, target_bg, result.COB);
        // only allow microboluses with COB or low temp targets, or within DIA hours of a bolus
        if (microBolusAllowed && enableSMB && bg > threshold) {
            // never bolus more than maxSMBBasalMinutes worth of basal


            let smbMinutesSetting =  DEFAULT_MAX_SMB_BASAL_MINUTES;
            if (profile.maxSMBBasalMinutes !== undefined) {
                smbMinutesSetting = profile.maxSMBBasalMinutes;
            }
            let uamMinutesSetting = DEFAULT_MAX_SMB_BASAL_MINUTES;
            if (profile.maxUAMSMBBasalMinutes !== undefined) {
                uamMinutesSetting = profile.maxUAMSMBBasalMinutes;
            }

            if (trio_custom_variables.useOverride && advancedSettings && smbMinutes !== smbMinutesSetting) {
                console.error("SMB Max Minutes - setting overriden from " + smbMinutesSetting + " to " + smbMinutes);
                smbMinutesSetting = smbMinutes;
            }
            if (trio_custom_variables.useOverride && advancedSettings && uamMinutes !== uamMinutesSetting) {
                console.error("UAM Max Minutes - setting overriden from " + uamMinutesSetting + " to " + uamMinutes);
                uamMinutesSetting = uamMinutes;
            }

            const mealInsulinReq = round( meal_data.mealCOB / carbRatio ,3);
            let maxBolus = 0;
            if (smbMinutesSetting === undefined) {
                maxBolus = round(profile.current_basal *overrideFactor * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR ,1);
                console.error("smbMinutesSetting undefined: defaulting to 30m");

                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxBolus: " + maxBolus + " ( " + insulinReq + " U)");
                }
            } else if ( iob_data.iob > mealInsulinReq && iob_data.iob > 0 ) {
                console.error("IOB" + iob_data.iob + "> COB" + meal_data.mealCOB + "; mealInsulinReq =" + mealInsulinReq);
                if (uamMinutesSetting) {
                    console.error("maxUAMSMBBasalMinutes: " + uamMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                    maxBolus = round(profile.current_basal * overrideFactor * uamMinutesSetting / MINUTES_PER_HOUR ,1);
                } else {
                    console.error("maxUAMSMBBasalMinutes undefined: defaulting to 30m");
                    maxBolus = round( profile.current_basal  * overrideFactor * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR ,1);
                }
                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxUAMSMBBasalMinutes [ " + uamMinutesSetting + "m ]: " + maxBolus + "U ( " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxUAMSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            } else {
                console.error(".maxSMBBasalMinutes: " + smbMinutesSetting + ", profile.current_basal: " + profile.current_basal * overrideFactor);
                maxBolus = round(profile.current_basal  * overrideFactor * smbMinutesSetting / MINUTES_PER_HOUR ,1);
                if( insulinReq > maxBolus ) {
                  console.error("SMB limited by maxSMBBasalMinutes: " + smbMinutesSetting + "m ]: " + maxBolus + "U ( insulinReq: " + insulinReq + "U )");
                } else { console.error("SMB is not limited by maxSMBBasalMinutes. ( insulinReq: " + insulinReq + "U )"); }
            }
            // bolus 1/2 the insulinReq, up to maxBolus, rounding down to nearest bolus increment
            const bolusIncrement = profile.bolus_increment!;
            //if (profile.bolus_increment) { bolusIncrement=profile.bolus_increment };
            const roundSMBTo = 1 / bolusIncrement;

            const smb_ratio = Math.min(profile.smb_delivery_ratio!, 1);

            if (smb_ratio != DEFAULT_SMB_DELIVERY_RATIO) {
                console.error("SMB Delivery Ratio changed from default 0.5 to " + round(smb_ratio,2))
            }
            let microBolus = Math.min(insulinReq*smb_ratio, maxBolus);

            microBolus = Math.floor(microBolus*roundSMBTo)/roundSMBTo;
            // calculate a long enough zero temp to eventually correct back up to target
            const smbTarget = target_bg;
            worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG)/2 ) / adjustedSens;
            durationReq = round(MINUTES_PER_HOUR*worstCaseInsulinReq / profile.current_basal * overrideFactor);

            // if insulinReq > 0 but not enough for a microBolus, don't set an SMB zero temp
            if (insulinReq > 0 && microBolus < bolusIncrement) {
                durationReq = 0;
            }

            let smbLowTempReq = 0;
            if (durationReq <= 0) {
                durationReq = 0;
            // don't set an SMB zero temp longer than 60 minutes
            } else if (durationReq >= TEMP_BASAL_DURATION_MINUTES) {
                durationReq = round(durationReq/TEMP_BASAL_DURATION_MINUTES)*TEMP_BASAL_DURATION_MINUTES;
                durationReq = Math.min(SMB_MAX_ZERO_TEMP_MINUTES,Math.max(0,durationReq));
            } else {
                // if SMB durationReq is less than 30m, set a nonzero low temp
                smbLowTempReq = round( basal * durationReq/TEMP_BASAL_DURATION_MINUTES ,2);
                durationReq = TEMP_BASAL_DURATION_MINUTES;
            }
            result.reason += " insulinReq " + insulinReq;
            if (microBolus >= maxBolus) {
                result.reason +=  "; maxBolus " + maxBolus;
            }
            if (durationReq > 0) {
                result.reason += "; setting " + durationReq + "m low temp of " + smbLowTempReq + "U/h";
            }
            result.reason += ". ";

            //allow SMBs every 3 minutes by default
            let SMBInterval = DEFAULT_SMB_INTERVAL_MINUTES;
            if (profile.SMBInterval) {
                // allow SMBIntervals between 1 and 10 minutes
                SMBInterval = Math.min(MAX_SMB_INTERVAL_MINUTES,Math.max(MIN_SMB_INTERVAL_MINUTES,profile.SMBInterval));
            }
            const nextBolusMins = round(SMBInterval-lastBolusAge,0);
            const nextBolusSeconds = round((SMBInterval - lastBolusAge) * SECONDS_PER_MINUTE, 0) % SECONDS_PER_MINUTE;
            //console.error(naive_eventualBG, insulinReq, worstCaseInsulinReq, durationReq);
            console.error("naive_eventualBG " + naive_eventualBG + "," + durationReq + "m " + smbLowTempReq + "U/h temp needed; last bolus " + lastBolusAge +"m ago; maxBolus: " + maxBolus);

            if (lastBolusAge > SMBInterval) {
                if (microBolus > 0) {
                    result.units = microBolus;
                    result.reason += "Microbolusing " + microBolus + "U. ";
                }
            } else {
                result.reason += "Waiting " + nextBolusMins + "m " + nextBolusSeconds + "s to microbolus again. ";
            }
            //result.reason += ". ";

            // if no zero temp is required, don't return yet; allow later code to set a high temp
            if (durationReq > 0) {
                result.rate = smbLowTempReq;
                result.duration = durationReq;
                return result;
            }

        }

        const maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

        if (rate > maxSafeBasal) {
            result.reason += "adj. req. rate: " + rate + " to maxSafeBasal: " + round(maxSafeBasal,2) + ", ";
            rate = round_basal(maxSafeBasal, profile);
        }

        insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
        if (insulinScheduled >= insulinReq * INSULIN_OVERSHOOT_FACTOR) { // if current temp would deliver >2x more than the required insulin, lower the rate
            result.reason += currenttemp.duration + "m@" + (currenttemp.rate).toFixed(2) + " > 2 * insulinReq. Setting temp basal of " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }

        if (currenttemp.duration === undefined || currenttemp.duration === 0) { // no temp is set
            result.reason += "no temp, setting " + rate + "U/hr. ";
            return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
        }

        if (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && (round_basal(rate, profile) <= round_basal(currenttemp.rate, profile))) { // if required temp <~ existing temp basal
            result.reason += "temp " + currenttemp.rate + " >~ req " + rate + "U/hr. ";
            return result;
        }

        // required temp > existing temp basal
        result.reason += "temp " + currenttemp.rate + "<" + rate + "U/hr. ";
        return tempBasalFunctions.setTempBasal(rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp);
    }
}

const determine_basal = function determine_basal(glucose_status: GlucoseStatus, currenttemp: CurrentTemp, iob_data: IOBData, profile: Profile, autosens_data: AutosensData, meal_data: MealData, tempBasalFunctions: TempBasalFunctions, microBolusAllowed: boolean, reservoir_data: number | undefined, currentTime: Date | string | undefined, _pumphistory: unknown[], preferences: Preferences, _basalprofile: BasalEntry[] | undefined, trio_custom_variables?: TrioCustomVariables, middleWare?: (arg: DetermineBasalResult) => DetermineBasalResult): DetermineBasalResult {

    if (!trio_custom_variables) {
        trio_custom_variables = DEFAULT_TRIO_CUSTOM_VARIABLES;
    }
    if (!preferences) {
        preferences = {} as Preferences;
    }
    if (profile === undefined || profile.current_basal === undefined) {
        return { error: 'Error: could not get current basal rate' } as unknown as DetermineBasalResult;
    }

    let profileTarget = profile.min_bg;
    const overrideTarget = trio_custom_variables.overrideTarget;
    if (overrideTarget != 0 && overrideTarget != OVERRIDE_TARGET_SENTINEL && trio_custom_variables.useOverride && !profile.temptargetSet) {
        profileTarget = overrideTarget;
    }
    const smbIsOff = trio_custom_variables.smbIsOff;
    const isfAndCr = trio_custom_variables.isfAndCr;
    const isf = trio_custom_variables.isf;
    const cr_ = trio_custom_variables.cr;
    // tdd past 24 hour
    let tdd = trio_custom_variables.currentTDD;

    let dynISFenabled = preferences.useNewFormula

    let insulinForManualBolus = 0;
    const manualBolusErrorString = 0;

    let systemTime = new Date();
    if (currentTime) {
        systemTime = new Date(currentTime);
    }



    const weightedAverage = trio_custom_variables.weightedAverage;
    let overrideFactor = 1;
    let sensitivity = profile.sens;
    let carbRatio = profile.carb_ratio;
    if (trio_custom_variables.useOverride) {
        overrideFactor = trio_custom_variables.overridePercentage / 100;
        if (isfAndCr) {
            sensitivity /= overrideFactor;
            carbRatio /= overrideFactor;
        } else {
            if (cr_) { carbRatio /= overrideFactor; }
            if (isf) { sensitivity /= overrideFactor; }
        }
    }
    const weightPercentage = profile.weightPercentage;
    const average_total_data = trio_custom_variables.average_total_data;

    const tdd_before = tdd;
    const dynResult = calculateDynamicISF(
        glucose_status, profile, preferences, autosens_data,
        sensitivity, profileTarget, dynISFenabled, tdd,
        weightedAverage, average_total_data, weightPercentage!, middleWare
    );
    dynISFenabled = dynResult.dynISFenabled;
    tdd = dynResult.tdd;
    const { tddReason, newRatio, insulinFactor, adjustmentFactor, enable_sigmoid, tdd24h_14d_Ratio } = dynResult;

    const cgmValidation = validateCGMData(
        glucose_status, profile, systemTime, overrideFactor,
        currenttemp, trio_custom_variables.useOverride, trio_custom_variables.duration
    );
    if ('earlyReturn' in cgmValidation) return cgmValidation.earlyReturn;
    const { bg, tick, minDelta, minAvgDelta, maxDelta, deliverAt, profile_current_basal } = cgmValidation;

    const sensTargets = configureSensitivityAndTargets(
        glucose_status, profile, autosens_data, profileTarget, overrideTarget,
        bg, dynISFenabled, newRatio, tdd24h_14d_Ratio, overrideFactor,
        profile_current_basal, tdd_before, weightedAverage, average_total_data,
        weightPercentage!, sensitivity, carbRatio, cgmValidation.basal, cgmValidation.reason
    );
    if ('earlyReturn' in sensTargets) return sensTargets.earlyReturn;
    const { max_iob, target_bg, min_bg, max_bg, high_bg, sensitivityRatio, adjustedSens, isfreason, targetLog } = sensTargets;
    let basal = sensTargets.basal;
    let threshold = sensTargets.threshold;

    let result = {} as DetermineBasalResult;
    if (cgmValidation.reason) {
        result.reason = cgmValidation.reason;
    }

    if (iob_data === undefined) {
        result.error ='Error: iob_data undefined. ';
        return result;
    }

    const iobArray = iob_data as unknown as IOBData[];

    if (typeof((iob_data as unknown as IOBData[]).length) && (iob_data as unknown as IOBData[]).length > 1) {
        iob_data = iobArray[0];
    }

    if (iob_data.activity === undefined || iob_data.iob === undefined) {
        result.error ='Error: iob_data missing some property. ';
        return result;
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
    //console.error("currenttemp:",currenttemp,"lastTemp:",JSON.stringify(iob_data.lastTemp),"lastTempAge:",lastTempAge,"m");
    const tempModulus = (lastTempAge + currenttemp.duration) % TEMP_BASAL_DURATION_MINUTES;
    console.error("currenttemp:" + currenttemp.rate + " lastTempAge:" + lastTempAge + "m, tempModulus:" + tempModulus + "m");
    result.temp = 'absolute';
    result.deliverAt = deliverAt as unknown as string;
    if ( microBolusAllowed && currenttemp && iob_data.lastTemp && currenttemp.rate !== iob_data.lastTemp.rate && lastTempAge > TEMP_AGE_STALE_MINUTES && currenttemp.duration ) {
        result.reason = "Warning: currenttemp rate " + currenttemp.rate + " != lastTemp rate " + iob_data.lastTemp.rate + " from pumphistory; canceling temp"; // reason.conclusion started
        return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
    }
    if ( currenttemp && iob_data.lastTemp && currenttemp.duration > 0 ) {
        //console.error(lastTempAge, round(iob_data.lastTemp.duration,1), round(lastTempAge - iob_data.lastTemp.duration,1));
        const lastTempEnded = lastTempAge - iob_data.lastTemp.duration;
        if ( lastTempEnded > TEMP_END_GAP_MINUTES && lastTempAge > TEMP_AGE_STALE_MINUTES ) {
            result.reason = "Warning: currenttemp running but lastTemp from pumphistory ended " + lastTempEnded + "m ago; canceling temp"; // reason.conclusion started
            //console.error(currenttemp, round(iob_data.lastTemp,1), round(lastTempAge,1));
            return tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp);
        }
    }

// Calculate BGI, deviation, and eventualBG.
// This has to happen after we obtain iob_data

    //calculate BG impact: the amount BG "should" be rising or falling based on insulin activity alone
    const bgImpact = round(( -iob_data.activity * adjustedSens * PRED_INTERVAL_MINUTES ), 2);
    // project deviations for 30 minutes
    let deviation = round( TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES * ( minDelta - bgImpact ) );
    // don't overreact to a big negative delta: use minAvgDelta if deviation is negative
    if (deviation < 0) {
        deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( minAvgDelta - bgImpact ) );
        // and if deviation is still negative, use long_avgdelta
        if (deviation < 0) {
            deviation = round( (TEMP_BASAL_DURATION_MINUTES / PRED_INTERVAL_MINUTES) * ( glucose_status.long_avgdelta - bgImpact ) );
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
    let eventualBG = naive_eventualBG + deviation;

    if (eventualBG === undefined || isNaN(eventualBG)) {
        result.error ='Error: could not calculate eventualBG. Sensitivity: ' + adjustedSens + ' Deviation: ' + deviation;
        return result;
    }
    const expectedDelta = calculate_expected_delta(target_bg, eventualBG, bgImpact);



    //console.error(reservoir_data);

// Initialize result (requestedTemp) object. Has to be done after eventualBG is calculated.
    result = {
        'temp': 'absolute'
        , 'bg': bg
        , 'tick': tick
        , 'eventualBG': eventualBG
        , 'insulinReq': 0
        , 'reservoir' : reservoir_data // The expected reservoir volume at which to deliver the microbolus (the reservoir volume from right before the last pumphistory run)
        , 'deliverAt' : deliverAt as unknown as string // The time at which the microbolus should be delivered
        , 'sensitivityRatio' : sensitivityRatio
        , 'CR' : round(carbRatio, 1)
        , 'current_target': target_bg
        , 'insulinForManualBolus': insulinForManualBolus
        , 'manualBolusErrorString': manualBolusErrorString
        , 'minDelta':  minDelta
        , 'expectedDelta':  expectedDelta
        , 'minGuardBG':  undefined
        , 'minPredBG':  undefined
        , 'threshold': convert_bg(threshold, profile)
    } as unknown as DetermineBasalResult;

    let enableSMB = false;

    // If SMB is always off, don't bother checking if we should enable SMBs
    if (smbIsOff) {
        console.error("SMBs are always off.");
        enableSMB = false;
    } else {
        enableSMB = enable_smb(
            profile,
            microBolusAllowed,
            meal_data,
            bg,
            target_bg,
            high_bg,
            trio_custom_variables,
            systemTime
        );
    }

    const enableUAM = (profile.enableUAM);

    //console.error(meal_data);
    const carbAbsorption = calculateCarbAbsorption(
        minDelta, bgImpact, adjustedSens, carbRatio, sensitivity,
        sensitivityRatio, meal_data, profile, systemTime
    );
    const { carbImpact, carbImpactDuration, uamCarbImpact, carbSensFactor, remainingCATime, remainingCIpeak, slopeFromDeviations } = carbAbsorption;

    const bgPred = generateBGPredictions(
        iobArray, eventualBG, naive_eventualBG, bg, adjustedSens,
        carbImpact, carbImpactDuration, uamCarbImpact,
        remainingCATime, remainingCIpeak, slopeFromDeviations,
        dynISFenabled, enable_sigmoid, tdd, adjustmentFactor, insulinFactor,
        enableUAM, target_bg, threshold, meal_data, profile
    );
    eventualBG = bgPred.eventualBG;
    result.eventualBG = eventualBG;
    result.predBGs = bgPred.predBGs;
    let minPredBG = bgPred.minPredBG;
    let minGuardBG = bgPred.minGuardBG;
    const { lastIOBpredBG, lastCOBpredBG, lastUAMpredBG, minIOBPredBG, IOBpredBGs, COBpredBGs } = bgPred;

    return calculateDosingDecision({
        result, iob_data, meal_data, profile, glucose_status, currenttemp,
        tempBasalFunctions, systemTime, trio_custom_variables,
        bg, eventualBG, naive_eventualBG,
        threshold, target_bg, min_bg, max_bg, max_iob,
        basal, adjustedSens, carbRatio, overrideFactor,
        expectedDelta, minDelta, maxDelta, tick,
        bgImpact, deviation,
        carbImpact, remainingCIpeak, carbSensFactor,
        minPredBG, minGuardBG,
        lastIOBpredBG, lastCOBpredBG, lastUAMpredBG,
        minIOBPredBG, IOBpredBGs, COBpredBGs,
        enableSMB, microBolusAllowed,
        isfreason, targetLog, tddReason,
    });

};

export default determine_basal;
