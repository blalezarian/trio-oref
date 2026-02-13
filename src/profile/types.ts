import type { InsulinCurve, CarbRatioUnits, BGUnits } from '../types/index';
import type { TempTarget } from './targets';

// ---------------------------------------------------------------------------
// ProfileDefaults — the full profile shape returned by generate()
// ---------------------------------------------------------------------------

export interface ProfileDefaults {
  // --- Core safety settings ---
  max_iob: number;
  max_daily_safety_multiplier: number;
  current_basal_safety_multiplier: number;
  autosens_max: number;
  autosens_min: number;
  rewind_resets_autosens: boolean;

  // --- Sensitivity / exercise ---
  high_temptarget_raises_sensitivity: boolean;
  low_temptarget_lowers_sensitivity: boolean;
  sensitivity_raises_target: boolean;
  resistance_lowers_target: boolean;
  exercise_mode: boolean;
  half_basal_exercise_target: number;

  // --- Meal / COB ---
  maxCOB: number;
  maxMealAbsorptionTime: number;
  min_5m_carbimpact: number;
  remainingCarbsFraction: number;
  remainingCarbsCap: number;

  // --- Temp basal ---
  skip_neutral_temps: boolean;
  unsuspend_if_no_temp: boolean;

  // --- Autotune ---
  autotune_isf_adjustmentFraction: number;

  // --- SMB ---
  enableUAM: boolean;
  A52_risk_enable: boolean;
  enableSMB_with_COB: boolean;
  enableSMB_with_temptarget: boolean;
  enableSMB_always: boolean;
  enableSMB_after_carbs: boolean;
  enableSMB_high_bg: boolean;
  enableSMB_high_bg_target: number;
  allowSMB_with_high_temptarget: boolean;
  maxSMBBasalMinutes: number;
  maxUAMSMBBasalMinutes: number;
  SMBInterval: number;
  bolus_increment: number;
  maxDelta_bg_threshold: number;
  smb_delivery_ratio: number;

  // --- Insulin curve ---
  curve: InsulinCurve;
  useCustomPeakTime: boolean;
  insulinPeakTime: number;

  // --- Misc ---
  carbsReqThreshold: number;
  offline_hotspot: boolean;
  noisyCGMTargetMultiplier: number;
  suspend_zeros_iob: boolean;
  enableEnliteBgproxy: boolean;
  calc_glucose_noise: boolean;
  target_bg: boolean | number;

  // --- Dynamic ISF ---
  adjustmentFactor: number;
  adjustmentFactorSigmoid: number;
  useNewFormula: boolean;
  sigmoid: boolean;
  weightPercentage: number;
  tddAdjBasal: boolean;
  threshold_setting: number;

  // --- Fields added by generate() ---
  dia?: number;
  model?: string;
  current_basal?: number;
  basalprofile?: Array<{ minutes?: number; i?: number; rate: number }>;
  max_daily_basal?: number;
  max_basal?: number;
  out_units?: BGUnits;
  min_bg?: number;
  max_bg?: number;
  bg_targets?: {
    user_preferred_units?: BGUnits;
    targets: Array<{ offset: number; low: number; high: number; min_bg?: number; max_bg?: number }>;
    raw?: unknown;
  };
  temptargetSet?: boolean;
  sens?: number;
  isfProfile?: { sensitivities: Array<{ offset: number; sensitivity: number }> };
  carb_ratio?: number;
  carb_ratios?: { units: CarbRatioUnits; schedule?: Array<{ offset: number; ratio: number }> };

  // --- Index signature for dynamic overrides ---
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ProfileInputs — input data for generate()
// ---------------------------------------------------------------------------

export interface ProfileInputs {
  settings: { insulin_action_curve: number; maxBasal: number };
  basals: Array<{ minutes?: number; i?: number; rate: number }>;
  targets: {
    user_preferred_units?: BGUnits;
    targets: Array<{ offset: number; low: number; high: number; min_bg?: number; max_bg?: number }>;
    raw?: unknown;
  };
  isf: { sensitivities: Array<{ offset: number; sensitivity: number }> };
  carbratio?: { units: CarbRatioUnits; schedule?: Array<{ offset: number; ratio: number }> };
  temptargets: TempTarget[];
  skip_neutral_temps?: boolean;
  model?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// ProfileOpts — optional second argument to generate()
// ---------------------------------------------------------------------------

export interface ProfileOpts {
  type?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GenerateFn — the augmented function shape exposed as default export
// ---------------------------------------------------------------------------

export interface GenerateFn {
  (inputs: ProfileInputs, opts?: ProfileOpts): ProfileDefaults | -1;
  defaults: () => ProfileDefaults;
  displayedDefaults: () => Partial<ProfileDefaults>;
}
