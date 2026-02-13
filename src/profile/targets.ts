
import { getTime } from '../utils/medtronic-clock';
import { MS_PER_MINUTE, MMOL_L_DETECTION_THRESHOLD, MIN_BG_TARGET, MAX_BG_TARGET, MMOL_TO_MGDL_FACTOR } from '../constants';
import type { BGUnits } from '../types/index';

interface BGTarget {
  offset?: number;
  low: number;
  high: number;
  min_bg?: number;
  max_bg?: number;
  temptargetSet?: boolean;
}

interface BGTargetsData {
  user_preferred_units?: BGUnits;
  targets: BGTarget[];
  raw?: unknown;
}

export interface TempTarget {
  created_at: string;
  duration: number;
  targetTop?: number;
  targetBottom?: number;
}

export interface TargetsInputs {
  targets: BGTargetsData;
  temptargets: TempTarget[];
}

export interface TargetsProfile {
  target_bg?: number | boolean;
  [key: string]: unknown;
}

function bgTargetsLookup (inputs: TargetsInputs, profile: TargetsProfile): BGTarget {
  return bound_target_range(lookup(inputs, profile));
}

function lookup (inputs: TargetsInputs, profile: TargetsProfile): BGTarget {
    const bgtargets_data = inputs.targets;
    const temptargets_data = inputs.temptargets;
    const now = new Date();

    let bgTargets = bgtargets_data.targets[bgtargets_data.targets.length - 1];

    for (let i = 0; i < bgtargets_data.targets.length - 1; i++) {
        if (now.getTime() >= getTime(bgtargets_data.targets[i].offset ?? 0) && now.getTime() < getTime(bgtargets_data.targets[i + 1].offset ?? 0)) {
            bgTargets = bgtargets_data.targets[i];
            break;
        }
    }

    if (profile.target_bg) {
        bgTargets.low = profile.target_bg as number;
    }

    bgTargets.high = bgTargets.low;

    let tempTargets = bgTargets;

    // sort tempTargets by date so we can process most recent first
    if (temptargets_data && temptargets_data.length > 0) {
        temptargets_data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    for (let i = 0; i < temptargets_data.length; i++) {
        const tt = temptargets_data[i];
        const start = new Date(tt.created_at);
        const expires = new Date(start.getTime() + tt.duration * MS_PER_MINUTE);

        if (now >= start && tt.duration === 0) {
            // cancel temp targets
            tempTargets = bgTargets;
            break;
        }
        if (!tt.targetBottom || !tt.targetTop) {
            console.error(`eventualBG target range invalid: ${tt.targetBottom}-${tt.targetTop}`);
            break;
        }
        if (now >= start && now < expires) {
            tempTargets.high = tt.targetTop;
            tempTargets.low = tt.targetBottom;
            tempTargets.temptargetSet = true;
            break;
        }
    }
    bgTargets = tempTargets;

    return bgTargets;
}

function bound_target_range (target: BGTarget): BGTarget {
    // if targets are < 20, assume for safety that they're intended to be mmol/L, and convert to mg/dL
    if ( target.high < MMOL_L_DETECTION_THRESHOLD ) { target.high = target.high * MMOL_TO_MGDL_FACTOR; }
    if ( target.low < MMOL_L_DETECTION_THRESHOLD ) { target.low = target.low * MMOL_TO_MGDL_FACTOR; }
    // hard-code lower bounds for min_bg and max_bg in case pump is set too low, or units are wrong
    target.max_bg = Math.max(MIN_BG_TARGET, target.high);
    target.min_bg = Math.max(MIN_BG_TARGET, target.low);
    // hard-code upper bound for min_bg in case pump is set too high
    target.min_bg = Math.min(MAX_BG_TARGET, target.min_bg);
    target.max_bg = Math.min(MAX_BG_TARGET, target.max_bg);
    return target
}

export { bgTargetsLookup, lookup, bound_target_range };
