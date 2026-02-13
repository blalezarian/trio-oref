import { scheduleOffsetToEpoch } from '../utils/time';
import { MS_PER_MINUTE, MMOL_L_DETECTION_THRESHOLD, MIN_BG_TARGET, MAX_BG_TARGET, MMOL_TO_MGDL_FACTOR } from '../shared/constants';
import type { BGUnits } from '../types/index';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/** Resolve which BG target is currently active (scheduled + temp overrides) */
function resolveCurrentTarget(
    inputs: TargetsInputs,
    profile: TargetsProfile,
    now: Date = new Date(),
): BGTarget {
    const scheduled = findActiveScheduledTarget(inputs.targets.targets, now);
    const withProfile = applyProfileOverride(scheduled, profile);
    return applyTempTargetOverride(withProfile, inputs.temptargets, now);
}

/** Return the current BG target, resolved and clamped to safety bounds */
function getCurrentBGTarget(
    inputs: TargetsInputs,
    profile: TargetsProfile,
    now: Date = new Date(),
): BGTarget {
    return clampTargetRange(resolveCurrentTarget(inputs, profile, now));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the scheduled target entry active at the given time of day */
function findActiveScheduledTarget(targets: BGTarget[], now: Date): BGTarget {
    const nowMs = now.getTime();

    for (let entryIdx = 0; entryIdx < targets.length - 1; entryIdx++) {
        const entryStart = scheduleOffsetToEpoch(targets[entryIdx].offset ?? 0);
        const nextStart = scheduleOffsetToEpoch(targets[entryIdx + 1].offset ?? 0);

        if (nowMs >= entryStart && nowMs < nextStart) {
            return targets[entryIdx];
        }
    }

    return targets[targets.length - 1];
}

/** Apply profile-level target_bg override (sets both low and high to that value) */
function applyProfileOverride(target: BGTarget, profile: TargetsProfile): BGTarget {
    if (typeof profile.target_bg === 'number') {
        target.low = profile.target_bg;
    }
    target.high = target.low;
    return target;
}

/** Sort temp targets newest-first (copies, does not mutate the input array) */
function sortTempTargetsNewestFirst(tempTargets: TempTarget[]): TempTarget[] {
    return [...tempTargets].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

/** Find and apply the most recent active temp target override */
function applyTempTargetOverride(
    target: BGTarget,
    tempTargets: TempTarget[],
    now: Date,
): BGTarget {
    if (!Array.isArray(tempTargets) || tempTargets.length === 0) {
        return target;
    }

    const sorted = sortTempTargetsNewestFirst(tempTargets);

    for (const tt of sorted) {
        const start = new Date(tt.created_at);

        // duration === 0 means "cancel all temp targets"
        if (now >= start && tt.duration === 0) {
            return target;
        }

        if (!tt.targetBottom || !tt.targetTop) {
            console.log(`eventualBG target range invalid: ${tt.targetBottom}-${tt.targetTop}`);
            return target;
        }

        const expires = new Date(start.getTime() + tt.duration * MS_PER_MINUTE);

        if (now >= start && now < expires) {
            target.high = tt.targetTop;
            target.low = tt.targetBottom;
            target.temptargetSet = true;
            return target;
        }
    }

    return target;
}

/** Convert mmol/L to mg/dL if below detection threshold */
function convertMmolIfNeeded(value: number): number {
    if (value < MMOL_L_DETECTION_THRESHOLD) {
        return value * MMOL_TO_MGDL_FACTOR;
    }
    return value;
}

/** Clamp a BG value to the safety range [MIN_BG_TARGET, MAX_BG_TARGET] */
function clampToSafeRange(value: number): number {
    return Math.min(MAX_BG_TARGET, Math.max(MIN_BG_TARGET, value));
}

/** Enforce safety bounds: convert mmol→mg/dL if needed, then clamp to [80, 200] */
function clampTargetRange(target: BGTarget): BGTarget {
    target.high = convertMmolIfNeeded(target.high);
    target.low = convertMmolIfNeeded(target.low);
    target.max_bg = clampToSafeRange(target.high);
    target.min_bg = clampToSafeRange(target.low);
    return target;
}

export {
    // Main
    getCurrentBGTarget,
    resolveCurrentTarget,
    clampTargetRange,
    // Helpers
    findActiveScheduledTarget,
    applyProfileOverride,
    sortTempTargetsNewestFirst,
    applyTempTargetOverride,
    convertMmolIfNeeded,
    clampToSafeRange,
};
export type { BGTarget, BGTargetsData };
