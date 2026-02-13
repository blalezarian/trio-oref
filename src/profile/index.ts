import { getCurrentBasalRate, getMaxDailyBasalRate, getMaxBasalRate } from './basal';
import { bgTargetsLookup } from './targets';
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

function generate (inputs: ProfileInputs, opts?: ProfileOpts): ProfileDefaults | -1 {
  const profile: ProfileDefaults = opts && opts.type ? opts as ProfileDefaults : defaults();

  // Apply input overrides for any matching default prefs
  for (const pref in profile) {
    if (inputs.hasOwnProperty(pref)) {
      (profile as Record<string, unknown>)[pref] = (inputs as Record<string, unknown>)[pref];
    }
  }

  // --- DIA validation ---
  if (inputs.settings.insulin_action_curve <= 1) {
    console.error('DIA of', profile.dia, 'is not supported');
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

  profile.basalprofile.forEach((basalentry) => {
    basalentry.rate = Math.round(basalentry.rate * 1000) / 1000;
  });

  profile.max_daily_basal = getMaxDailyBasalRate(inputs);
  profile.max_basal = getMaxBasalRate(inputs);

  if (profile.current_basal === 0) {
    console.error("current_basal of",profile.current_basal,"is not supported");
    return -1;
  }
  if (profile.max_daily_basal === 0) {
    console.error("max_daily_basal of",profile.max_daily_basal,"is not supported");
    return -1;
  }
  if (profile.max_basal! < MIN_SUPPORTED_MAX_BASAL) {
    console.error("max_basal of",profile.max_basal,"is not supported");
    return -1;
  }

  // --- BG targets ---
  const range = bgTargetsLookup(inputs as TargetsInputs, profile);
  profile.out_units = inputs.targets.user_preferred_units;
  profile.min_bg = Math.round(range.min_bg!);
  profile.max_bg = Math.round(range.max_bg!);
  profile.bg_targets = inputs.targets;

  profile.bg_targets.targets.forEach((bg_entry) => {
    bg_entry.high = Math.round(bg_entry.high);
    bg_entry.low = Math.round(bg_entry.low);
    bg_entry.min_bg = Math.round(bg_entry.min_bg!);
    bg_entry.max_bg = Math.round(bg_entry.max_bg!);
  });

  delete profile.bg_targets.raw;

  // --- ISF ---
  profile.temptargetSet = range.temptargetSet;
  profile.sens = isfLookup(inputs.isf);
  profile.isfProfile = inputs.isf;
  if (profile.sens! < MIN_SUPPORTED_ISF) {
    console.error("ISF of",profile.sens,"is not supported");
    return -1;
  }

  // --- Carb ratio ---
  if (inputs.carbratio !== undefined) {
    profile.carb_ratio = carbRatioLookup(inputs);
    profile.carb_ratios = inputs.carbratio;
  } else {
    console.error("Profile wasn't given carb ratio data, cannot calculate carb_ratio");
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
