import type { TrioCustomVariables } from '../types/index';

// === Local constants for determine-basal ===

// --- Data quality / error thresholds ---
/** CGM calibrating or error state ceiling (mg/dL) */
export const BG_ERROR_CEILING = 10;
/** xDrip sensor failure error code */
export const XDRIP_ERROR_CODE = 38;
/** CGM noise level at or above which data is considered unreliable */
export const CGM_NOISE_LEVEL_MEDIUM = 3;
/** Suppress unchanged-data warnings below this BG (mg/dL) */
export const BG_UNCHANGED_FLOOR = 60;
/** BG data older than this (minutes) is considered too old */
export const MAX_BG_DATA_AGE_MINUTES = 12;
/** BG data from further in the future than this (minutes) is invalid */
export const MAX_BG_FUTURE_MINUTES = 5;
/** Calibration recency threshold (minutes) -- just calibrated */
export const RECENT_CAL_THRESHOLD = 3;

// --- Target BG adjustment ---
/** Pivot point for autosens-based target BG adjustment (mg/dL) */
export const TARGET_BG_PIVOT = 60;
/** Minimum multiplier for noisy CGM target raise */
export const MIN_NOISY_TARGET_MULTIPLIER = 1.1;
/** Maximum raw BG value considered valid for noise adjustment */
export const MAX_RAW_BG = 250;

// --- Threshold calculation ---
/** Factor applied to (min_bg - offset) for threshold computation */
export const THRESHOLD_FACTOR = 0.5;
/** Offset subtracted from min_bg in threshold formula (mg/dL) */
export const THRESHOLD_BG_OFFSET = 40;
/** Minimum allowed threshold BG (mg/dL) */
export const MIN_THRESHOLD_BG = 60;
/** Maximum allowed threshold BG (mg/dL) */
export const MAX_THRESHOLD_BG = 120;

// --- Temp basal decision thresholds ---
/** Temp age (minutes) above which a rate mismatch triggers cancellation */
export const TEMP_AGE_STALE_MINUTES = 10;
/** Minutes since last temp ended to trigger cancellation */
export const TEMP_END_GAP_MINUTES = 5;
/** Minimum remaining temp duration (minutes) to consider it "active" */
export const TEMP_ACTIVE_DURATION_MINUTES = 15;
/** Short temp duration threshold (minutes) */
export const TEMP_SHORT_DURATION_MINUTES = 5;
/** Low rate tolerance factor for current temp comparison */
export const RATE_TOLERANCE_LOW = 0.8;
/** Fraction of basal below which scheduled insulin is considered a shortfall */
export const BASAL_SHORTFALL_FRACTION = 0.3;
/** Factor applied to insulinReq when current temp delivers too much */
export const INSULIN_OVERSHOOT_FACTOR = 2;

// --- Low glucose / safety ---
/** BG floor (mg/dL) for safety checks on naive/carbs-required eventualBG */
export const LOW_BG_SAFETY_THRESHOLD = 40;
/** Minutes of negative IOB to check before suppressing LGS */
export const IOB_NEG_CHECK_MINUTES = 20;
/** Multiplier for low-temp insulin correction */
export const LOW_TEMP_CORRECTION_FACTOR = 2;

// --- Prediction durations ---
/** Maximum prediction horizon (minutes) for above-min/above-threshold checks */
export const PRED_HORIZON_MAX_MINUTES = 240;
/** Threshold (minutes above min_bg) that triggers carbs-required evaluation */
export const MINUTES_ABOVE_MIN_BG_THRESHOLD = 60;
/** Window (minutes above threshold) within which carbsReq is displayed */
export const CARBS_REQ_WINDOW_MINUTES = 45;

// --- Carb absorption ---
/** Extension factor applied to lastCarbAge for remainingCATime */
export const CARB_TIME_EXTENSION_FACTOR = 1.5;
/** Fraction of COB discounted when computing carbsReq */
export const COB_DISCOUNT_FRACTION = 0.25;
/** Hours over which UAM deviation impact decays to zero */
export const UAM_DECAY_HOURS = 3;

// --- Prediction array trimming ---
/** Minimum data points to retain when trimming flat prediction tails */
export const MIN_PRED_TRIM_POINTS = 12;
/** Minimum data points to retain when trimming ZT predictions */
export const MIN_ZT_TRIM_POINTS = 6;
/** Upper cap for COB predicted BG (mg/dL) */
export const COB_PRED_BG_CAP = 1500;

// --- Dynamic ISF exercise threshold ---
/** Target BG (mg/dL) at/above which dynamic ISF is disabled during exercise */
export const DYNISF_EXERCISE_THRESHOLD = 118;

// --- SMB settings ---
/** Minimum SMB interval (minutes) */
export const MIN_SMB_INTERVAL_MINUTES = 1;
/** Maximum SMB interval (minutes) */
export const MAX_SMB_INTERVAL_MINUTES = 10;
/** Default maxDelta BG threshold fraction for SMB disablement */
export const DEFAULT_MAX_DELTA_BG_THRESHOLD = 0.2;
/** Safety cap for maxDelta BG threshold fraction */
export const MAX_DELTA_BG_THRESHOLD_CAP = 0.4;
/** Maximum duration (minutes) for SMB zero-temp */
export const SMB_MAX_ZERO_TEMP_MINUTES = 60;

// --- Neutral temp near top of hour ---
/** Minutes before the hour at which neutral temps are cancelled */
export const TOP_OF_HOUR_WINDOW_MINUTES = 55;

// --- Calculation parameters ---
/** Hours over which expectedDelta is calculated */
export const EXPECTED_DELTA_HOURS = 2;
/** CGM noise level at or above which target BG is raised for safety */
export const CGM_NOISE_LEVEL_NOISY = 2;
/** Delta threshold (mg/dL) below which BG change is considered negligible */
export const DELTA_UNCHANGED_THRESHOLD = 1;
/** Divisor for triangular (linear decay) carb impact area calculation */
export const LINEAR_DECAY_FACTOR = 2;
/** Divisor for dampening slope from minimum deviation */
export const SLOPE_DAMPENING_DIVISOR = 3;
/** Sentinel BG value meaning "no prediction calculated yet" */
export const PRED_BG_SENTINEL = 999;
/** Delta difference threshold (mg/dL) for classifying glucose change significance */
export const DELTA_SIGNIFICANCE_THRESHOLD = 2;
/** Override target sentinel meaning "not set" (~0.33 mmol/L, impossibly low as a real target) */
export const OVERRIDE_TARGET_SENTINEL = 6;
/** Seconds per minute -- used for minutes-to-seconds display conversion */
export const SECONDS_PER_MINUTE = 60;

// --- Manual bolus error codes (sent to Trio iOS app) ---
/** Guard BG below safety threshold */
export const BOLUS_ERR_GUARD_BELOW_THRESHOLD = 1;
/** LGS mode: guard BG below threshold */
export const BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD = 2;
/** BG rising slower than expected */
export const BOLUS_ERR_RISING_SLOWER = 3;
/** BG falling or mixed direction */
export const BOLUS_ERR_FALLING_OR_MIXED = 4;
/** Other delta mismatch */
export const BOLUS_ERR_OTHER_DELTA = 5;
/** Min predicted BG below minimum target */
export const BOLUS_ERR_MIN_PRED_BELOW_MIN = 6;

// --- Default trio_custom_variables ---
export const DEFAULT_TRIO_CUSTOM_VARIABLES: TrioCustomVariables = {
    // Override settings
    useOverride: false,
    overridePercentage: 100,
    overrideTarget: 0,
    // Advanced ISF/CR toggles
    advancedSettings: false,
    isfAndCr: false,
    isf: false,
    cr: false,
    // SMB scheduling
    smbIsOff: false,
    smbIsScheduledOff: false,
    start: 0,
    end: 0,
    smbMinutes: 30,
    uamMinutes: 30,
    // TDD data
    currentTDD: 0,
    average_total_data: 0,
    weightedAverage: 0,
    duration: 0,
};
