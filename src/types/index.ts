/**
 * TypeScript type definitions for the trio-oref algorithm data structures.
 *
 * These types capture the exact shape of all inputs and outputs flowing through
 * the oref0 algorithm as used by Trio. They serve as both documentation and
 * compile-time contracts for the characterization test suite.
 *
 * SAFETY NOTE: This code controls insulin delivery for people with Type 1 diabetes.
 * Every field matters. Every type must match the actual runtime behavior exactly.
 */

// ---------------------------------------------------------------------------
// Shared type aliases
// ---------------------------------------------------------------------------

/** Insulin absorption curve model used across all modules */
export type InsulinCurve = 'bilinear' | 'rapid-acting' | 'ultra-rapid';

/** Medtronic pump history event types */
export type PumpHistoryEventType =
  | 'Bolus'
  | 'BolusWizard'
  | 'TempBasal'
  | 'TempBasalDuration'
  | 'PumpSuspend'
  | 'PumpResume'
  | 'JournalEntryMealMarker'
  | 'Rewind';

/** Nightscout Care Portal event types */
export type NightscoutEventType =
  | 'Meal Bolus'
  | 'Correction Bolus'
  | 'Snack Bolus'
  | 'Bolus Wizard'
  | 'Carb Correction'
  | 'Temp Basal';

/** Data entry source identifiers */
export type EnteredBySource =
  | 'xdrip'
  | 'HAPP_App'
  | 'openaps://AndroidAPS'
  | (string & {});

/** Temp basal type */
export type TempBasalType = 'percent' | 'absolute';

/** Glucose entry type */
export type GlucoseEntryType = 'cal' | 'mbg' | (string & {});

/** Carb ratio units */
export type CarbRatioUnits = 'grams' | 'exchanges';

/** BG display units */
export type BGUnits = 'mg/dL' | 'mmol/L';

/** Meal absorption phase marker */
export type MealAbsorptionPhase = 'start' | 'end';

/** Unix timestamp in milliseconds (e.g. Date.now(), Date.getTime()) */
export type EpochMillis = number;

/** ISO 8601 date string (e.g. "2025-01-15T12:00:00.000Z") */
export type ISODateString = string;

// ---------------------------------------------------------------------------
// Pump History Event — raw events from Medtronic pump or Nightscout
// ---------------------------------------------------------------------------

/** Broad interface for pump history events. Uses optional fields + index
 *  signature rather than a discriminated union to avoid narrowing logic
 *  changes. Covers Medtronic _type events, Nightscout eventType events,
 *  and Care Portal entries. */
export interface PumpHistoryEvent {
  // -- Event type discriminators --
  /** Medtronic event type (e.g. "Bolus", "TempBasal", "PumpSuspend") */
  _type?: PumpHistoryEventType | (string & {});
  /** Nightscout event type (e.g. "Meal Bolus", "Correction Bolus") */
  eventType?: NightscoutEventType | (string & {});

  // -- Timestamps --
  /** ISO timestamp string */
  timestamp?: string;
  /** Nightscout created_at ISO timestamp */
  created_at?: string;

  // -- Insulin & bolus --
  /** Insulin delivery amount in Units (bolus) */
  amount?: number;
  /** Insulin amount in Units (Nightscout treatment) */
  insulin?: number;
  /** Programmed bolus amount in Units */
  programmed?: number;
  /** Temp basal rate in U/hr */
  rate?: number;
  /** Duration in minutes */
  duration?: number;
  /** Duration in minutes (Medtronic alternate field) */
  'duration (min)'?: number;
  /** Absolute temp basal rate */
  absolute?: number;
  /** Percentage temp basal */
  percent?: number;
  /** Temp type: "percent" or "absolute" */
  temp?: TempBasalType;

  // -- Carb fields --
  /** Carbs in grams (Nightscout) */
  carbs?: number;
  /** Carb input in grams (Medtronic BolusWizard / JournalEntryMealMarker) */
  carb_input?: number;

  // -- Bolus Wizard fields --
  /** Carb ratio used by Bolus Wizard */
  carb_ratio?: number;
  /** Food estimate from Bolus Wizard */
  food_estimate?: number;
  /** Correction estimate from Bolus Wizard */
  correction_estimate?: number;
  /** Total bolus estimate from Bolus Wizard */
  bolus_estimate?: number;
  /** BG reading used by Bolus Wizard (mg/dL) */
  bg?: number;
  /** Low BG target for Bolus Wizard */
  bg_target_low?: number;
  /** High BG target for Bolus Wizard */
  bg_target_high?: number;
  /** ISF used by Bolus Wizard */
  sensitivity?: number;

  // -- Metadata --
  /** Entry source (e.g. "xdrip", "HAPP_App", "openaps://AndroidAPS") */
  enteredBy?: EnteredBySource;

  // -- Nested objects --
  /** Nested bolus object (Medtronic compound events) */
  bolus?: { _type?: PumpHistoryEventType; amount?: number; programmed?: number; timestamp?: string; duration?: number };

  /** Allow additional fields present in pump data */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Glucose Entry — raw CGM entry from Nightscout / xDrip / Dexcom
// ---------------------------------------------------------------------------

/** Raw CGM glucose entry as received from the glucose data source */
export interface GlucoseEntry {
  /** Glucose value in mg/dL */
  glucose?: number;
  /** Nightscout sgv field (used interchangeably with glucose) */
  sgv?: number;
  /** Epoch milliseconds timestamp */
  date?: number;
  /** Display timestamp string */
  display_time?: string;
  /** ISO date string */
  dateString?: string;
  /** CGM device identifier */
  device?: string;
  /** CGM noise level */
  noise?: number;
  /** Entry type (e.g. "cal" for calibration) */
  type?: GlucoseEntryType;
  /** xDrip start timestamp */
  xDrip_started_at?: string;
}

// ---------------------------------------------------------------------------
// Bucketed Glucose — time-bucketed glucose datum used by autosens/cob
// ---------------------------------------------------------------------------

/** Glucose data point bucketed into 5-minute intervals for autosens,
 *  COB, and categorize calculations */
export interface BucketedGlucose {
  /** Glucose value in mg/dL */
  glucose?: number;
  /** Epoch milliseconds timestamp */
  date?: number;
  /** Display timestamp string */
  display_time?: string;
  /** ISO date string */
  dateString?: string;
}

// ---------------------------------------------------------------------------
// Carb Treatment — carb entry extracted from meal history
// ---------------------------------------------------------------------------

/** Carb/bolus entry extracted from pump history by meal/history.ts */
export interface CarbTreatment {
  /** ISO timestamp string */
  timestamp: string;
  /** Total carbs in grams */
  carbs?: number;
  /** Carbs entered via Nightscout Care Portal (g) */
  nsCarbs?: number;
  /** Carbs from Medtronic Bolus Wizard (g) */
  bwCarbs?: number;
  /** Carbs from journal/meal marker entries (g) */
  journalCarbs?: number;
  /** Bolus amount in Units */
  bolus?: number;
}

// ---------------------------------------------------------------------------
// Glucose Status — output of glucose-get-last.js
// ---------------------------------------------------------------------------

/** Current glucose reading with trend information, produced by glucose-get-last.js */
export interface GlucoseStatus {
  /** Current blood glucose in mg/dL (averaged with readings within 2.5m) */
  glucose: number;
  /** 5-minute BG change in mg/dL (average of readings 2.5–7.5m ago) */
  delta: number;
  /** ~15-minute average delta in mg/dL/5m (readings 2.5–17.5m ago) */
  short_avgdelta: number;
  /** ~30-minute average delta in mg/dL/5m (readings 17.5–42.5m ago) */
  long_avgdelta: number;
  /** CGM noise level (Dexcom noise estimate) */
  noise?: number;
  /** Timestamp of the glucose reading (epoch ms) */
  date?: number;
  /** Calibration record index (0 = no recent calibration) */
  last_cal?: number;
  /** CGM device identifier string */
  device?: string;
}

// ---------------------------------------------------------------------------
// Current Temp Basal
// ---------------------------------------------------------------------------

/** Current temporary basal rate state from the pump */
export interface CurrentTemp {
  /** Remaining duration in minutes (0 = no temp active) */
  duration: number;
  /** Current temp basal rate in U/hr */
  rate: number;
  /** Temp basal type — Trio always uses 'absolute' */
  temp?: TempBasalType;
}

// ---------------------------------------------------------------------------
// IOB (Insulin On Board)
// ---------------------------------------------------------------------------

/** Single IOB calculation at a point in time, from iob/total.js */
export interface IOBEntry {
  /** Total insulin on board in Units */
  iob: number;
  /** Current insulin activity in U/min (how fast insulin is acting) */
  activity: number;
  /** IOB from basal adjustments only (treatments < 0.1U) */
  basaliob: number;
  /** IOB from boluses only (treatments >= 0.1U) */
  bolusiob: number;
  /** Net basal insulin delivered in Units */
  netbasalinsulin: number;
  /** Total bolus insulin delivered in Units */
  bolusinsulin: number;
  /** Time this IOB was calculated for */
  time: Date;
}

/** IOB data as seen by determine-basal (first element of IOB array with extras) */
export interface IOBData extends IOBEntry {
  /** Projected IOB assuming continuous zero temp from now */
  iobWithZeroTemp?: IOBEntry;
  /** Epoch ms of the most recent bolus */
  lastBolusTime?: number;
  /** Most recent temp basal treatment */
  lastTemp?: {
    rate: number;
    duration: number;
    date: number;
    started_at?: string;
  };
}

/** Per-treatment insulin absorption contribution, from iob/calculate.js */
export interface IOBContribution {
  /** Units of insulin used in the previous minute */
  activityContrib: number;
  /** Units of insulin still remaining */
  iobContrib: number;
}

/** Treatment record extracted from pump history, used by IOB calculations */
export interface Treatment {
  /** Insulin amount in Units (bolus or temp basal increment) */
  insulin?: number;
  /** Timestamp of treatment (epoch ms) */
  date: number;
  /** ISO timestamp string of when treatment started */
  started_at?: string;
  /** ISO timestamp string */
  timestamp?: string;
  /** Temp basal rate in U/hr (present for temp basals) */
  rate?: number;
  /** Duration in minutes (present for temp basals) */
  duration?: number;
  /** Created-at ISO timestamp */
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Meal Data
// ---------------------------------------------------------------------------

/** Meal/carb data, output of meal/total.js */
export interface MealData {
  /** Total active carbs in the meal absorption window (g) */
  carbs: number;
  /** Carbs entered via Nightscout Care Portal (g) */
  nsCarbs: number;
  /** Carbs from Medtronic Bolus Wizard (g) */
  bwCarbs: number;
  /** Carbs from journal/meal marker entries (g) */
  journalCarbs: number;
  /** Carbs on board — carbs not yet absorbed (g), capped by maxCOB */
  mealCOB: number;
  /** Current BG deviation from expected (mg/dL) */
  currentDeviation: number;
  /** Maximum deviation since meal start (mg/dL) */
  maxDeviation: number;
  /** Minimum deviation since meal start (mg/dL) */
  minDeviation: number;
  /** Rate of deviation change from peak (negative = absorbing) */
  slopeFromMaxDeviation: number;
  /** Rate of deviation change from trough (positive = recovering) */
  slopeFromMinDeviation: number;
  /** Array of rounded deviation values for the absorption period */
  allDeviations: number[];
  /** Epoch ms of last carb entry */
  lastCarbTime?: number;
  /** True if Bolus Wizard was used in the last 6 hours */
  bwFound: boolean;
  /** Status reason string (e.g. "Could not parse clock data") */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Basal schedule entry */
export interface BasalEntry {
  /** Minutes from midnight (0 = midnight, 360 = 6 AM) */
  minutes: number;
  /** Basal rate in U/hr */
  rate: number;
}

/** BG target schedule entry */
export interface BGTargetEntry {
  /** Minutes from midnight */
  offset: number;
  /** Low end of target range in mg/dL */
  low: number;
  /** High end of target range in mg/dL */
  high: number;
  /** Min BG target (computed) */
  min_bg?: number;
  /** Max BG target (computed) */
  max_bg?: number;
}

/** ISF schedule entry */
export interface ISFEntry {
  /** Minutes from midnight */
  offset: number;
  /** Insulin sensitivity factor in mg/dL per Unit */
  sensitivity: number;
}

/** Carb ratio schedule entry */
export interface CarbRatioEntry {
  /** Minutes from midnight */
  offset: number;
  /** Grams of carbs per Unit of insulin */
  ratio: number;
}

/** Full profile object as produced by profile/index.js and consumed by determine-basal */
export interface Profile {
  // -- Safety limits --
  /** Maximum IOB the algorithm will target (Units). 0 = low-glucose-suspend only */
  max_iob: number;
  /** max_basal <= this * max_daily_basal */
  max_daily_safety_multiplier: number;
  /** max_basal <= this * current_basal */
  current_basal_safety_multiplier: number;
  /** Maximum autosens ratio (caps insulin increase) */
  autosens_max: number;
  /** Minimum autosens ratio (caps insulin decrease) */
  autosens_min: number;

  // -- Insulin dynamics --
  /** Duration of insulin action in hours */
  dia: number;
  /** Insulin absorption curve model */
  curve: InsulinCurve;
  /** Whether to use a custom insulin peak time */
  useCustomPeakTime: boolean;
  /** Minutes after bolus when insulin activity peaks */
  insulinPeakTime: number;

  // -- Basal rates --
  /** Current scheduled basal rate at this time of day (U/hr) */
  current_basal: number;
  /** Highest rate in the 24-hour basal schedule (U/hr) */
  max_daily_basal: number;
  /** Pump-configured maximum basal rate (U/hr) */
  max_basal: number;
  /** Full basal schedule */
  basalprofile?: BasalEntry[];

  // -- BG targets --
  /** Minimum BG target in mg/dL */
  min_bg: number;
  /** Maximum BG target in mg/dL */
  max_bg: number;
  /** Display units preference */
  out_units?: BGUnits;
  /** Full BG target schedule */
  bg_targets?: { targets: BGTargetEntry[]; user_preferred_units?: BGUnits };
  /** Whether a temporary target is currently active */
  temptargetSet?: boolean;

  // -- Insulin sensitivity --
  /** Current ISF in mg/dL per Unit */
  sens: number;
  /** Full ISF schedule (for time-of-day lookups) */
  isfProfile?: { sensitivities: ISFEntry[] };

  // -- Carb ratios --
  /** Current carb ratio in grams per Unit */
  carb_ratio: number;
  /** Full carb ratio schedule */
  carb_ratios?: { units: CarbRatioUnits; schedule: CarbRatioEntry[] };

  // -- Meal absorption --
  /** Maximum COB the algorithm will consider (safety cap, g) */
  maxCOB?: number;
  /** Hours of meal absorption to consider */
  maxMealAbsorptionTime?: number;
  /** Minimum assumed carb impact in mg/dL per 5 min */
  min_5m_carbimpact?: number;

  // -- SMB settings --
  /** Enable SMB when COB > 0 */
  enableSMB_with_COB?: boolean;
  /** Enable SMB always (unless high temp target blocks it) */
  enableSMB_always?: boolean;
  /** Enable SMB when a low temp target is set */
  enableSMB_with_temptarget?: boolean;
  /** Enable SMB for 6h after any carb entry */
  enableSMB_after_carbs?: boolean;
  /** Enable SMB when BG is above enableSMB_high_bg_target */
  enableSMB_high_bg?: boolean;
  /** BG threshold for high-BG SMB enablement (mg/dL) */
  enableSMB_high_bg_target?: number;
  /** Allow SMB even with high temp targets */
  allowSMB_with_high_temptarget?: boolean;
  /** Max minutes of basal deliverable as SMB with COB */
  maxSMBBasalMinutes?: number;
  /** Max minutes of basal deliverable as SMB during UAM */
  maxUAMSMBBasalMinutes?: number;
  /** Minimum interval between SMBs in minutes */
  SMBInterval?: number;
  /** Minimum bolus increment for SMBs (Units) */
  bolus_increment?: number;

  // -- UAM --
  /** Enable Unannounced Meal detection */
  enableUAM?: boolean;

  // -- Advanced / Trio-specific --
  /** Medtronic Bolus Wizard safety check */
  A52_risk_enable?: boolean;
  /** Exercise mode / high temp target raises sensitivity */
  exercise_mode?: boolean;
  /** Synonym for exercise_mode */
  high_temptarget_raises_sensitivity?: boolean;
  /** Low temp target lowers sensitivity */
  low_temptarget_lowers_sensitivity?: boolean;
  /** Target BG at which basal drops to 50% in exercise mode */
  half_basal_exercise_target?: number;
  /** Skip setting neutral temp basals */
  skip_neutral_temps?: boolean;
  /** Fraction of total insulin req deliverable as SMB */
  smb_delivery_ratio?: number;
  /** Max BG delta to allow SMBs (fraction) */
  maxDelta_bg_threshold?: number;
  /** Multiplier for target when CGM is noisy */
  noisyCGMTargetMultiplier?: number;
  /** Maximum raw BG value (mg/dL) used in noisy CGM target adjustment */
  maxRaw?: number;
  /** Whether pump suspends should zero out IOB */
  suspend_zeros_iob?: boolean;
  /** Reset autosens on pump rewind */
  rewind_resets_autosens?: boolean;
  /** Sensitivity raises target */
  sensitivity_raises_target?: boolean;
  /** Resistance lowers target */
  resistance_lowers_target?: boolean;
  /** Pump model identifier */
  model?: string;
  /** Remaining carbs fraction for future absorption */
  remainingCarbsFraction?: number;
  /** Cap on remaining carbs estimate */
  remainingCarbsCap?: number;
  /** Carbs required threshold for alerts */
  carbsReqThreshold?: number;
  /** Static target override */
  target_bg?: number | boolean;
  /** Un-suspend pump if no temp running */
  unsuspend_if_no_temp?: boolean;

  // -- Dynamic ISF (Trio) --
  /** Adjustment factor for logarithmic dynamic ISF */
  adjustmentFactor?: number;
  /** Adjustment factor for sigmoid dynamic ISF */
  adjustmentFactorSigmoid?: number;
  /** Enable dynamic ISF (logarithmic formula) */
  useNewFormula?: boolean;
  /** Enable sigmoid variant of dynamic ISF */
  sigmoid?: boolean;
  /** Weight percentage for TDD averaging (0–1) */
  weightPercentage?: number;
  /** Enable TDD-based basal adjustment */
  tddAdjBasal?: boolean;
  /** Glucose threshold setting (mg/dL) */
  threshold_setting?: number;
}

// ---------------------------------------------------------------------------
// Autosens Data
// ---------------------------------------------------------------------------

/** Auto-sensitivity detection result */
export interface AutosensData {
  /** Sensitivity ratio (1.0 = normal, >1 = resistant, <1 = sensitive) */
  ratio: number;
}

// ---------------------------------------------------------------------------
// Trio Custom Variables — Trio-specific overrides passed to determine-basal
// ---------------------------------------------------------------------------

/** Trio-specific custom variables injected by the Trio iOS app */
export interface TrioCustomVariables {
  /** Whether a profile override is active */
  useOverride: boolean;
  /** Override target BG in mg/dL (0 = no override) */
  overrideTarget: number;
  /** Override percentage (100 = normal) */
  overridePercentage: number;
  /** Override duration in minutes (0 = indefinite) */
  duration: number;
  /** Whether SMBs are disabled by override */
  smbIsOff: boolean;
  /** Whether SMBs are disabled on a schedule */
  smbIsScheduledOff: boolean;
  /** Schedule start hour for SMB disable window */
  start: number;
  /** Schedule end hour for SMB disable window */
  end: number;
  /** Whether advanced override settings are active */
  advancedSettings: boolean;
  /** Whether ISF and CR are both overridden together */
  isfAndCr: boolean;
  /** Whether ISF is overridden independently */
  isf: boolean;
  /** Whether CR is overridden independently */
  cr: boolean;
  /** Override for maxSMBBasalMinutes */
  smbMinutes: number;
  /** Override for maxUAMSMBBasalMinutes */
  uamMinutes: number;
  /** Current total daily dose (past 24h) in Units */
  currentTDD: number;
  /** Weighted average TDD across multiple days */
  weightedAverage: number;
  /** Average total data (typically 14-day average TDD) */
  average_total_data: number;
}

// ---------------------------------------------------------------------------
// Preferences — subset of profile fields used as algorithm preferences
// ---------------------------------------------------------------------------

/** Algorithm preferences passed separately to determine-basal */
export interface Preferences {
  /** Enable dynamic ISF formula */
  useNewFormula: boolean;
  /** Adjustment factor for logarithmic ISF */
  adjustmentFactor: number;
  /** Adjustment factor for sigmoid ISF */
  adjustmentFactorSigmoid: number;
  /** Use sigmoid instead of logarithmic */
  sigmoid: boolean;
  /** Insulin curve type */
  curve: InsulinCurve;
  /** Use custom insulin peak time */
  useCustomPeakTime: boolean;
}

// ---------------------------------------------------------------------------
// Determine-Basal Output
// ---------------------------------------------------------------------------

/** The complete output of determine-basal — the algorithm's insulin dosing decision */
export interface DetermineBasalResult {
  /** Recommended temp basal rate in U/hr */
  rate?: number;
  /** Recommended temp basal duration in minutes */
  duration?: number;
  /** Temp basal type */
  temp?: 'absolute';
  /** Human-readable explanation of the algorithm's decision */
  reason: string;
  /** Error message if the algorithm could not run */
  error?: string;
  /** Recommended SMB amount in Units */
  units?: number;
  /** Grams of carbs needed to reach target (for alerts) */
  carbsReq?: number;
  /** Timestamp for when to deliver the recommendation */
  deliverAt?: string;
  /** Current carbs on board (echoed from meal_data) */
  mealCOB?: number;

  // -- Predicted BG curves --
  /** Predicted BGs based on IOB only */
  predBGs?: {
    IOB?: number[];
    ZT?: number[];
    COB?: number[];
    UAM?: number[];
    aCOB?: number[];
  };

  // -- Trio-specific output fields --
  /** Minimum predicted BG from IOB curve */
  minPredBG?: number;
  /** Minimum guarded predicted BG */
  minGuardBG?: number;
  /** Current ISF used by the algorithm */
  ISF?: number;
  /** Current carb ratio used */
  CR?: number;
  /** Eventual BG if only basal continues */
  eventualBG?: number;
  /** Insulin required for correction */
  insulinReq?: number;
  /** Sensitivity ratio applied */
  sensitivityRatio?: number;
  /** Target BG used for calculations */
  target_bg?: number;
  /** Dynamic ISF/ratio log information */
  reason_log?: string;

  // -- Additional Trio output fields read by iOS app --
  /** Current carbs on board (COB) in grams */
  COB?: number;
  /** Current insulin on board (IOB) in Units */
  IOB?: number;
  /** Blood glucose impact rate in display units */
  BGI?: number;
  /** Current deviation from expected BG in display units */
  deviation?: number;
  /** Current target BG (unrounded, in display units) */
  current_target?: number;
  /** Manual bolus error state code */
  manualBolusErrorString?: number;
  /** Insulin suggested for manual bolus in Units */
  insulinForManualBolus?: number;
  /** Minimum delta between last two readings */
  minDelta?: number;
  /** Expected delta based on IOB activity */
  expectedDelta?: number;

  // Allow additional fields the algorithm may produce
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Temp Basal Functions interface
// ---------------------------------------------------------------------------

/** The tempBasalFunctions object from basal-set-temp.js */
export interface TempBasalFunctions {
  getMaxSafeBasal: (profile: Profile) => number;
  setTempBasal: (
    rate: number,
    duration: number,
    profile: Profile,
    requestedTempBasalResult: DetermineBasalResult,
    currenttemp: CurrentTemp,
  ) => DetermineBasalResult;
}

// ---------------------------------------------------------------------------
// Full determine-basal input bundle (for fixture files)
// ---------------------------------------------------------------------------

/** Complete set of inputs for a single determine-basal invocation */
export interface DetermineBasalInputs {
  glucose_status: GlucoseStatus;
  currenttemp: CurrentTemp;
  iob_data: IOBData;
  profile: Profile;
  autosens_data: AutosensData;
  meal_data: MealData;
  microBolusAllowed: boolean;
  reservoir_data?: number;
  currentTime?: string;
  pumphistory?: unknown[];
  preferences: Preferences;
  basalprofile?: BasalEntry[];
  trio_custom_variables: TrioCustomVariables;
  middleWare?: unknown;
}

/** A single characterization test fixture: input + expected output */
export interface DetermineBasalFixture {
  /** Human-readable name for this test scenario */
  name: string;
  /** Category/scenario group */
  category: string;
  /** All inputs to determine-basal */
  input: DetermineBasalInputs;
  /** The exact output produced by the JS algorithm */
  output: DetermineBasalResult;
}

// ---------------------------------------------------------------------------
// IOB Module inputs/outputs (for sub-module fixtures)
// ---------------------------------------------------------------------------

/** Inputs to iob/index.js generate() */
export interface IOBInputs {
  clock: string;
  history: unknown[];
  profile: {
    dia: number;
    curve: InsulinCurve;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;
    current_basal?: number;
    suspend_zeros_iob?: boolean;
  };
  autosens?: AutosensData;
}

/** Inputs to meal/index.js generate() */
export interface MealInputs {
  clock: string;
  history: unknown[];
  carbs?: unknown[];
  glucose?: unknown[];
  profile: {
    maxMealAbsorptionTime?: number;
    maxCOB?: number;
    min_5m_carbimpact?: number;
    carb_ratio?: number;
    sens?: number;
    isfProfile?: { sensitivities: ISFEntry[] };
  };
  basalprofile?: BasalEntry[];
}
