interface ProfileDefaults {
  max_iob: number;
  max_daily_safety_multiplier: number;
  current_basal_safety_multiplier: number;
  autosens_max: number;
  autosens_min: number;
  rewind_resets_autosens: boolean;
  high_temptarget_raises_sensitivity: boolean;
  low_temptarget_lowers_sensitivity: boolean;
  sensitivity_raises_target: boolean;
  resistance_lowers_target: boolean;
  exercise_mode: boolean;
  half_basal_exercise_target: number;
  maxCOB: number;
  maxMealAbsorptionTime: number;
  skip_neutral_temps: boolean;
  unsuspend_if_no_temp: boolean;
  min_5m_carbimpact: number;
  autotune_isf_adjustmentFraction: number;
  remainingCarbsFraction: number;
  remainingCarbsCap: number;
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
  curve: string;
  useCustomPeakTime: boolean;
  insulinPeakTime: number;
  carbsReqThreshold: number;
  offline_hotspot: boolean;
  noisyCGMTargetMultiplier: number;
  suspend_zeros_iob: boolean;
  enableEnliteBgproxy: boolean;
  calc_glucose_noise: boolean;
  target_bg: boolean | number;
  smb_delivery_ratio: number;
  adjustmentFactor: number;
  adjustmentFactorSigmoid: number;
  useNewFormula: boolean;
  sigmoid: boolean;
  weightPercentage: number;
  tddAdjBasal: boolean;
  threshold_setting: number;
}

interface ProfileInputs {
  settings: { insulin_action_curve: number; maxBasal: number };
  basals: Array<{ minutes?: number; i?: number; rate: number }>;
  targets: {
    user_preferred_units?: string;
    targets: Array<{ offset: number; low: number; high: number; min_bg?: number; max_bg?: number }>;
    raw?: unknown;
  };
  isf: { sensitivities: Array<{ offset: number; sensitivity: number }> };
  carbratio?: { units: string; schedule?: Array<{ offset: number; ratio: number }> };
  temptargets: Array<Record<string, unknown>>;
  skip_neutral_temps?: boolean;
  model?: string;
  [key: string]: unknown;
}

interface ProfileOpts {
  type?: string;
  [key: string]: unknown;
}

interface GeneratedProfile extends ProfileDefaults {
  dia: number;
  model?: string;
  current_basal: number;
  basalprofile: Array<{ minutes?: number; i?: number; rate: number }>;
  max_daily_basal: number;
  max_basal: number;
  out_units: string | undefined;
  min_bg: number;
  max_bg: number;
  bg_targets: {
    user_preferred_units?: string;
    targets: Array<{ offset: number; low: number; high: number; min_bg: number; max_bg: number }>;
  };
  temptargetSet?: boolean;
  sens: number;
  isfProfile: { sensitivities: Array<{ offset: number; sensitivity: number }> };
  carb_ratio?: number;
  carb_ratios?: { units: string; schedule?: Array<{ offset: number; ratio: number }> };
  [key: string]: unknown;
}

interface Generate {
  (inputs: ProfileInputs, opts?: ProfileOpts): GeneratedProfile | -1;
  defaults: () => ProfileDefaults;
  displayedDefaults: () => Partial<ProfileDefaults>;
}

declare const generate: Generate;
export = generate;
