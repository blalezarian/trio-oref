import { getCurrentBasalRate, getMaxDailyBasalRate, getMaxBasalRate } from './basal';
import { roundTo3dp } from '../utils/rounding';
import { getCurrentBGTarget } from './targets';
import type { TargetsInputs } from './targets';
import { isfLookup } from './isf';
import { carbRatioLookup } from './carbs';
import { defaults, displayedDefaults } from './defaults';
import type {
    ProfileDefaults,
    ProfileInputs,
    ProfileOpts,
    GenerateFn,
} from './types';

/** Minimum max_basal supported (U/hr) */
const MIN_SUPPORTED_MAX_BASAL = 0.1;
/** Minimum ISF supported (mg/dL/U) */
const MIN_SUPPORTED_ISF = 5;

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

/** Build a complete profile from pump settings, overriding defaults with provided inputs */
function generate(inputs: ProfileInputs, opts?: ProfileOpts): ProfileDefaults | -1 {
  const profile: ProfileDefaults = opts && opts.type ? opts as ProfileDefaults : defaults();

  // Apply input overrides for any matching default prefs
  for (const pref in profile) {
    if (inputs.hasOwnProperty(pref)) {
      (profile as Record<string, unknown>)[pref] = (inputs as Record<string, unknown>)[pref];
    }
  }

  // --- DIA validation ---
  if (inputs.settings.insulin_action_curve <= 1) {
    console.log(`DIA of ${profile.dia} is not supported`);
    return -1;
  }
  profile.dia = inputs.settings.insulin_action_curve;

  if (inputs.model) {
    profile.model = inputs.model;
  }
  profile.skip_neutral_temps = inputs.skip_neutral_temps ?? false;

  // --- Basal rates ---
  profile.current_basal = getCurrentBasalRate(inputs.basals);
  profile.basalprofile = inputs.basals;

  profile.basalprofile.forEach((basalEntry) => {
    basalEntry.rate = roundTo3dp(basalEntry.rate);
  });

  profile.max_daily_basal = getMaxDailyBasalRate(inputs);
  profile.max_basal = getMaxBasalRate(inputs);

  if (profile.current_basal === 0) {
    console.log(`current_basal of ${profile.current_basal} is not supported`);
    return -1;
  }
  if (profile.max_daily_basal === 0) {
    console.log(`max_daily_basal of ${profile.max_daily_basal} is not supported`);
    return -1;
  }
  if ((profile.max_basal as number) < MIN_SUPPORTED_MAX_BASAL) {
    console.log(`max_basal of ${profile.max_basal} is not supported`);
    return -1;
  }

  // --- BG targets ---
  const range = getCurrentBGTarget(inputs as TargetsInputs, profile);
  profile.out_units = inputs.targets.user_preferred_units;
  profile.min_bg = Math.round(range.min_bg as number);
  profile.max_bg = Math.round(range.max_bg as number);
  profile.bg_targets = inputs.targets;

  profile.bg_targets.targets.forEach((bgEntry) => {
    bgEntry.high = Math.round(bgEntry.high);
    bgEntry.low = Math.round(bgEntry.low);
    bgEntry.min_bg = Math.round(bgEntry.min_bg as number);
    bgEntry.max_bg = Math.round(bgEntry.max_bg as number);
  });

  delete profile.bg_targets.raw;

  // --- ISF ---
  profile.temptargetSet = range.temptargetSet;
  profile.sens = isfLookup(inputs.isf);
  profile.isfProfile = inputs.isf;
  if ((profile.sens as number) < MIN_SUPPORTED_ISF) {
    console.log(`ISF of ${profile.sens} is not supported`);
    return -1;
  }

  // --- Carb ratio ---
  if (inputs.carbratio !== undefined) {
    profile.carb_ratio = carbRatioLookup(inputs);
    profile.carb_ratios = inputs.carbratio;
  } else {
    console.log("Profile wasn't given carb ratio data, cannot calculate carb_ratio");
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

(generate as GenerateFn).defaults = defaults;
(generate as GenerateFn).displayedDefaults = displayedDefaults;
export default generate as GenerateFn;
export { generate };
