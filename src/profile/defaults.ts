import type { ProfileDefaults } from './types';
import {
    DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER,
    DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER,
    DEFAULT_AUTOSENS_MAX,
    DEFAULT_AUTOSENS_MIN,
    EXERCISE_HALF_BASAL_TARGET,
    DEFAULT_MAX_MEAL_ABSORPTION_HOURS,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
    DEFAULT_SMB_INTERVAL_MINUTES,
    DEFAULT_SMB_DELIVERY_RATIO,
    RAPID_ACTING_PEAK,
    DEFAULT_REMAINING_CARBS_CAP,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// defaults()
// ---------------------------------------------------------------------------

/** Return the full set of default profile values */
function defaults(): ProfileDefaults {
    return {
        // Safety limits
        max_iob: 0,
        max_daily_safety_multiplier: DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER,
        current_basal_safety_multiplier: DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER,

        // Autosens
        autosens_max: DEFAULT_AUTOSENS_MAX,
        autosens_min: DEFAULT_AUTOSENS_MIN,
        rewind_resets_autosens: true,

        // Sensitivity & targets
        high_temptarget_raises_sensitivity: false,
        low_temptarget_lowers_sensitivity: false,
        sensitivity_raises_target: false,
        resistance_lowers_target: false,

        // Exercise mode
        exercise_mode: false,
        half_basal_exercise_target: EXERCISE_HALF_BASAL_TARGET,

        // Carb absorption
        maxCOB: 120,
        maxMealAbsorptionTime: DEFAULT_MAX_MEAL_ABSORPTION_HOURS,
        min_5m_carbimpact: 8,
        remainingCarbsFraction: 1.0,
        remainingCarbsCap: DEFAULT_REMAINING_CARBS_CAP,

        // Temp basal behavior
        skip_neutral_temps: false,
        unsuspend_if_no_temp: false,

        // Autotune
        autotune_isf_adjustmentFraction: 1.0,

        // UAM & SMB enables
        enableUAM: false,
        A52_risk_enable: false,
        enableSMB_with_COB: false,
        enableSMB_with_temptarget: false,
        enableSMB_always: false,
        enableSMB_after_carbs: false,
        enableSMB_high_bg: false,
        enableSMB_high_bg_target: 110,
        allowSMB_with_high_temptarget: false,

        // SMB delivery parameters
        maxSMBBasalMinutes: DEFAULT_MAX_SMB_BASAL_MINUTES,
        maxUAMSMBBasalMinutes: DEFAULT_MAX_SMB_BASAL_MINUTES,
        SMBInterval: DEFAULT_SMB_INTERVAL_MINUTES,
        bolus_increment: 0.1,
        maxDelta_bg_threshold: 0.2,
        smb_delivery_ratio: DEFAULT_SMB_DELIVERY_RATIO,

        // Insulin curve
        curve: 'rapid-acting',
        useCustomPeakTime: false,
        insulinPeakTime: RAPID_ACTING_PEAK,

        // Misc
        carbsReqThreshold: 1,
        offline_hotspot: false,
        noisyCGMTargetMultiplier: 1.3,
        suspend_zeros_iob: true,
        enableEnliteBgproxy: false,
        calc_glucose_noise: false,
        target_bg: false,

        // Dynamic ISF
        adjustmentFactor: 0.8,
        adjustmentFactorSigmoid: 0.5,
        useNewFormula: false,
        sigmoid: false,
        weightPercentage: 0.65,
        tddAdjBasal: false,
        threshold_setting: 60,
    };
}

// ---------------------------------------------------------------------------
// displayedDefaults()
// ---------------------------------------------------------------------------

/** Return the subset of default profile values intended for display to the user */
function displayedDefaults(): Partial<ProfileDefaults> {
    const allDefaults = defaults();
    const profile: Record<string, unknown> = { };

    profile.max_iob = allDefaults.max_iob;
    profile.max_daily_safety_multiplier = allDefaults.max_daily_safety_multiplier;
    profile.current_basal_safety_multiplier= allDefaults.current_basal_safety_multiplier;
    profile.autosens_max = allDefaults.autosens_max;
    profile.autosens_min = allDefaults.autosens_min;
    profile.rewind_resets_autosens = allDefaults.rewind_resets_autosens;
    profile.exercise_mode = allDefaults.exercise_mode;
    profile.sensitivity_raises_target = allDefaults.sensitivity_raises_target;
    profile.unsuspend_if_no_temp = allDefaults.unsuspend_if_no_temp;
    profile.enableSMB_with_COB = allDefaults.enableSMB_with_COB;
    profile.enableSMB_with_temptarget = allDefaults.enableSMB_with_temptarget;
    profile.enableUAM = allDefaults.enableUAM;
    profile.curve = allDefaults.curve;
    profile.offline_hotspot = allDefaults.offline_hotspot;
    profile.bolus_increment = allDefaults.bolus_increment;
    profile.smb_delivery_ratio = allDefaults.smb_delivery_ratio;
    profile.maxDelta_bg_threshold = allDefaults.maxDelta_bg_threshold;
    profile.adjustmentFactor = allDefaults.adjustmentFactor;
    profile.adjustmentFactorSigmoid = allDefaults.adjustmentFactorSigmoid;
    profile.useNewFormula = allDefaults.useNewFormula;
    profile.sigmoid = allDefaults.sigmoid;
    profile.weightPercentage = allDefaults.weightPercentage;
    profile.tddAdjBasal = allDefaults.tddAdjBasal;
    profile.threshold_setting = allDefaults.threshold_setting;
    profile.enableSMB_high_bg = allDefaults.enableSMB_high_bg;
    profile.enableSMB_high_bg_target = allDefaults.enableSMB_high_bg_target;
    profile.maxCOB = allDefaults.maxCOB;
    profile.maxMealAbsorptionTime = allDefaults.maxMealAbsorptionTime;

    console.error(profile);
    return profile as Partial<ProfileDefaults>;
}

export { defaults, displayedDefaults };
