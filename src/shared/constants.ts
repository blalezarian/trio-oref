// Shared constants used across multiple oref0 modules.
// Values extracted from hardcoded "magic numbers" for readability and auditability.

// === Glucose Thresholds ===

/** Below this, glucose reading is considered invalid */
export const MIN_VALID_GLUCOSE_MGDL = 39;
/** Above this, glucose reading is unreliable */
export const MAX_VALID_GLUCOSE_MGDL = 400;

// === Unit Conversion ===

/** mg/dL to mmol/L: value_mgdl * MGDL_TO_MMOL = value_mmol */
export const MGDL_TO_MMOL = 0.0555;
/** Threshold below which a BG target is assumed to be in mmol/L */
export const MMOL_L_DETECTION_THRESHOLD = 20;
/** mmol/L to mg/dL multiplier */
export const MMOL_TO_MGDL_FACTOR = 18;

// === Time Constants ===

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_5_MIN = 300_000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const HOURS_PER_DAY = 24;

// === Prediction Loop ===

/** Maximum prediction BG array length: 4 hours at 5-min intervals */
export const PRED_BG_MAX_LENGTH = 48;
/** Minutes per prediction step */
export const PRED_INTERVAL_MINUTES = 5;

// === Safety Limits ===

/** Default max_daily_safety_multiplier: max temp = N * max_daily_basal */
export const DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER = 3;
/** Default current_basal_safety_multiplier: max temp = N * current_basal */
export const DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER = 4;

// === CGM Noise Thresholds ===

export const NOISE_CLEAN_THRESHOLD = 0.35;
export const NOISE_LIGHT_THRESHOLD = 0.5;
export const NOISE_MEDIUM_THRESHOLD = 0.7;
/** |deltaSGV| exceeding this indicates Heavy noise */
export const MAX_DELTA_FOR_NOISE = 30;
/** Glucose below this in noise context is considered invalid */
export const NOISE_MIN_VALID_GLUCOSE = 30;
/** MAXRECORDS for sensor noise calculation window */
export const NOISE_MAX_RECORDS = 8;
/** MINRECORDS required for sensor noise calculation */
export const NOISE_MIN_RECORDS = 4;

// === Insulin Curve Defaults ===

/** Default rapid-acting peak time (minutes) */
export const RAPID_ACTING_PEAK = 75;
/** Default ultra-rapid peak time (minutes) */
export const ULTRA_RAPID_PEAK = 55;
/** Minimum DIA in hours (forced floor) */
export const MIN_DIA_HOURS = 3;
/** Minimum DIA for exponential curves in hours */
export const MIN_LONG_DIA_HOURS = 5;
/** Maximum DIA for autotune in hours */
export const MAX_DIA_HOURS = 12;
/** Default DIA in hours */
export const DEFAULT_DIA_HOURS = 3;

// === Autotune / Autosens Adjustment ===

/** Default autosens/autotune maximum ratio */
export const DEFAULT_AUTOSENS_MAX = 1.2;
/** Default autosens/autotune minimum ratio */
export const DEFAULT_AUTOSENS_MIN = 0.7;
/** Fraction of adjustment applied per autotune iteration */
export const AUTOTUNE_ADJUSTMENT_FRACTION = 0.2;
/** Maximum lookback deviations: 8h of 5-min data */
export const DEFAULT_AUTOSENS_LOOKBACK = 96;
/** Median percentile used for autosens/autotune deviation analysis */
export const MEDIAN_PERCENTILE = 0.50;

// === Target BG Bounds ===

/** Hard lower bound for target BG (mg/dL) */
export const MIN_BG_TARGET = 80;
/** Hard upper bound for target BG (mg/dL) */
export const MAX_BG_TARGET = 200;

// === Exercise / Temp Target Defaults ===

/** Default normal target for exercise sensitivity evaluation (mg/dL) */
export const EXERCISE_NORMAL_TARGET = 100;
/** Default half-basal exercise target (mg/dL) */
export const EXERCISE_HALF_BASAL_TARGET = 160;

// === Temp Basal Defaults ===

/** Standard temp basal duration (minutes) */
export const TEMP_BASAL_DURATION_MINUTES = 30;
/** Maximum temp basal duration (minutes) */
export const MAX_TEMP_BASAL_DURATION_MINUTES = 120;

// === SMB Defaults ===

/** Default SMB delivery ratio */
export const DEFAULT_SMB_DELIVERY_RATIO = 0.5;
/** Default SMB interval (minutes) */
export const DEFAULT_SMB_INTERVAL_MINUTES = 3;
/** Default maxSMBBasalMinutes */
export const DEFAULT_MAX_SMB_BASAL_MINUTES = 30;

// === Suspend / Max DIA Window ===

/** Maximum DIA hours for suspend IOB calculation */
export const MAX_DIA_FOR_SUSPEND_HOURS = 8;

// === Carb Absorption ===

/** Default max meal absorption time (hours) */
export const DEFAULT_MAX_MEAL_ABSORPTION_HOURS = 6;
/** Default max carb absorption rate (g/h) */
export const DEFAULT_MAX_CARB_ABSORPTION_RATE = 30;
/** Default assumed carb absorption rate (g/h) */
export const DEFAULT_ASSUMED_CARB_ABSORPTION_RATE = 20;
/** Default minimum remaining carb absorption time (hours) */
export const DEFAULT_REMAINING_CA_TIME_MIN_HOURS = 3;
/** Default remaining carbs cap (grams) */
export const DEFAULT_REMAINING_CARBS_CAP = 90;

// === Round Basal Scale Factors ===

/** Default pump basal rounding scale (Omnipod: 0.05 U increments) */
export const BASAL_SCALE_DEFAULT = 20;
/** Medtronic x23/x54 basal rounding scale (0.025 U increments) */
export const BASAL_SCALE_MEDTRONIC = 40;

// === Dynamic ISF Constants ===

/** Logarithmic formula denominator */
export const DYNAMIC_ISF_LOG_DENOMINATOR = 1800;
/** Chris Wilson formula denominator */
export const DYNAMIC_ISF_CHRIS_DENOMINATOR = 277700;

// === Trend Calculation ===

/** Maximum minutes for trend history window */
export const TREND_MAX_MINUTES = 16;

// === Carb Ratio Bounds ===

/** Minimum valid carb ratio (g/U) */
export const MIN_CARB_RATIO = 1;
/** Maximum valid carb ratio (g/U) */
export const MAX_CARB_RATIO = 150;

// === Exponential Curve Peak Bounds ===

/** Rapid-acting maximum peak time (minutes) */
export const RAPID_ACTING_MAX_PEAK = 120;
/** Rapid-acting minimum peak time (minutes) */
export const RAPID_ACTING_MIN_PEAK = 50;
/** Ultra-rapid maximum peak time (minutes) */
export const ULTRA_RAPID_MAX_PEAK = 100;
/** Ultra-rapid minimum peak time (minutes) */
export const ULTRA_RAPID_MIN_PEAK = 35;

// === Bilinear Model Constants ===

/** Default DIA for bilinear model (hours) */
export const BILINEAR_DEFAULT_DIA_HOURS = 3.0;
/** Peak time for bilinear model (minutes) */
export const BILINEAR_PEAK_MINUTES = 75;
/** End of insulin activity for bilinear model (minutes) */
export const BILINEAR_END_MINUTES = 180;

// === Insulin Peak Time (determine-basal) ===

/** Minutes after dosing to start evaluating minPredBG */
export const INSULIN_PEAK_WAIT_MINUTES = 90;

// === Deviation Improvement Threshold ===

/** Minimum improvement ratio for autotune DIA/peak adjustments */
export const AUTOTUNE_IMPROVEMENT_THRESHOLD = 0.99;

// === Rapid-acting Insulin Activity (determine-basal) ===

/** Default insulin peak activity offset for rapid-acting */
export const RAPID_ACTING_ACTIVITY_OFFSET = 65;
/** Default insulin peak activity offset for ultra-rapid */
export const ULTRA_RAPID_ACTIVITY_OFFSET = 50;
/** Insulin factor ceiling */
export const INSULIN_FACTOR_CEILING = 120;

// === Curve Defaults in iob/total ===

/** Minimum time (minutes) for exponential curves */
export const EXPONENTIAL_MIN_TD = 300;

// === BG Bucketing (shared: autosens, categorize, cob) ===

/** BG validity threshold for autosens/autotune bucketing (mg/dL) */
export const AUTOSENS_MIN_VALID_BG = 40;
/** Elapsed-minutes gap at or below which BG readings merge into same bucket */
export const BUCKETING_MERGE_THRESHOLD_MIN = 2;

