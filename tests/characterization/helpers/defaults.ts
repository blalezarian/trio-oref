/**
 * Default/baseline input values for characterization tests.
 *
 * These represent a "steady state, in-range" scenario that can be
 * selectively overridden to create specific test scenarios.
 * Values are based on the existing mocha tests and realistic clinical values.
 */

import type {
  GlucoseStatus,
  CurrentTemp,
  IOBData,
  MealData,
  Profile,
  AutosensData,
  TrioCustomVariables,
  Preferences,
  BasalEntry,
} from '../../types/index.js';

/** Steady-state, in-range glucose with no trend */
export function defaultGlucoseStatus(overrides?: Partial<GlucoseStatus>): GlucoseStatus {
  return {
    glucose: 115,
    delta: 0,
    short_avgdelta: 0,
    long_avgdelta: 0,
    date: Date.now() - 60_000, // 1 minute ago
    noise: 1,
    last_cal: 0,
    device: 'fakecgm',
    ...overrides,
  };
}

/** No temp basal running */
export function defaultCurrentTemp(overrides?: Partial<CurrentTemp>): CurrentTemp {
  return {
    duration: 0,
    rate: 0,
    temp: 'absolute',
    ...overrides,
  };
}

/** Zero IOB — no active insulin */
export function defaultIOBData(overrides?: Partial<IOBData>): IOBData {
  const now = new Date();
  return {
    iob: 0,
    activity: 0,
    basaliob: 0,
    bolusiob: 0,
    netbasalinsulin: 0,
    bolusinsulin: 0,
    time: now,
    iobWithZeroTemp: {
      iob: 0,
      activity: 0,
      basaliob: 0,
      bolusiob: 0,
      netbasalinsulin: 0,
      bolusinsulin: 0,
      time: now,
    },
    lastBolusTime: 0,
    lastTemp: {
      rate: 0,
      duration: 0,
      date: 0,
    },
    ...overrides,
  };
}

/** No recent meal — zero COB, zero carbs */
export function defaultMealData(overrides?: Partial<MealData>): MealData {
  return {
    carbs: 0,
    nsCarbs: 0,
    bwCarbs: 0,
    journalCarbs: 0,
    mealCOB: 0,
    currentDeviation: 0,
    maxDeviation: 0,
    minDeviation: 0,
    slopeFromMaxDeviation: 0,
    slopeFromMinDeviation: 0,
    allDeviations: [0, 0, 0, 0, 0],
    lastCarbTime: 0,
    bwFound: false,
    ...overrides,
  };
}

/** Standard Type 1 profile — moderate settings, SMBs disabled by default */
export function defaultProfile(overrides?: Partial<Profile>): Profile {
  return {
    // Safety limits
    max_iob: 2.5,
    max_daily_safety_multiplier: 3,
    current_basal_safety_multiplier: 4,
    autosens_max: 1.2,
    autosens_min: 0.7,

    // Insulin dynamics
    dia: 5,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    insulinPeakTime: 75,

    // Basal rates
    current_basal: 0.9,
    max_daily_basal: 1.3,
    max_basal: 3.5,

    // BG targets
    min_bg: 110,
    max_bg: 120,
    out_units: 'mg/dL',
    temptargetSet: false,

    // Sensitivity
    sens: 40,
    isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },

    // Carb ratio
    carb_ratio: 10,

    // Meal absorption
    maxCOB: 120,
    maxMealAbsorptionTime: 6,
    min_5m_carbimpact: 8,

    // SMB (all off by default for baseline)
    enableSMB_with_COB: false,
    enableSMB_always: false,
    enableSMB_with_temptarget: false,
    enableSMB_after_carbs: false,
    enableSMB_high_bg: false,
    enableSMB_high_bg_target: 110,
    allowSMB_with_high_temptarget: false,
    maxSMBBasalMinutes: 30,
    maxUAMSMBBasalMinutes: 30,
    SMBInterval: 3,
    bolus_increment: 0.1,

    // UAM
    enableUAM: false,

    // Advanced
    A52_risk_enable: false,
    exercise_mode: false,
    high_temptarget_raises_sensitivity: false,
    low_temptarget_lowers_sensitivity: false,
    half_basal_exercise_target: 160,
    skip_neutral_temps: false,
    smb_delivery_ratio: 0.5,
    maxDelta_bg_threshold: 0.2,
    noisyCGMTargetMultiplier: 1.3,
    suspend_zeros_iob: true,
    rewind_resets_autosens: true,
    sensitivity_raises_target: false,
    resistance_lowers_target: false,
    remainingCarbsFraction: 1.0,
    remainingCarbsCap: 90,
    carbsReqThreshold: 1,
    unsuspend_if_no_temp: false,

    // Dynamic ISF (Trio)
    adjustmentFactor: 0.8,
    adjustmentFactorSigmoid: 0.5,
    useNewFormula: false,
    sigmoid: false,
    weightPercentage: 0.65,
    tddAdjBasal: false,
    threshold_setting: 60,

    ...overrides,
  };
}

/** Neutral autosens — no sensitivity adjustment */
export function defaultAutosensData(overrides?: Partial<AutosensData>): AutosensData {
  return {
    ratio: 1.0,
    ...overrides,
  };
}

/** Default Trio custom variables — no overrides active */
export function defaultTrioCustomVariables(
  overrides?: Partial<TrioCustomVariables>,
): TrioCustomVariables {
  return {
    useOverride: false,
    overrideTarget: 0,
    overridePercentage: 100,
    duration: 0,
    smbIsOff: false,
    smbIsScheduledOff: false,
    start: 0,
    end: 0,
    advancedSettings: false,
    isfAndCr: false,
    isf: false,
    cr: false,
    smbMinutes: 30,
    uamMinutes: 30,
    currentTDD: 40,
    weightedAverage: 40,
    average_total_data: 40,
    ...overrides,
  };
}

/** Default preferences — dynamic ISF off */
export function defaultPreferences(overrides?: Partial<Preferences>): Preferences {
  return {
    useNewFormula: false,
    adjustmentFactor: 0.8,
    adjustmentFactorSigmoid: 0.5,
    sigmoid: false,
    curve: 'rapid-acting',
    useCustomPeakTime: false,
    ...overrides,
  };
}

/** Standard 24h basal schedule — flat 0.9 U/hr */
export function defaultBasalProfile(): BasalEntry[] {
  return [{ minutes: 0, rate: 0.9 }];
}
