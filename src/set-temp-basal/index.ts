import { round_basal } from '../utils/rounding';
import {
    DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER,
    DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER,
    MAX_TEMP_BASAL_DURATION_MINUTES,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Duration tolerance (minutes) when comparing current temp to suggested */
const TEMP_DURATION_TOLERANCE_MINUTES = 10;
/** Upper rate tolerance factor for current temp comparison */
const RATE_TOLERANCE_HIGH = 1.2;
/** Lower rate tolerance factor for current temp comparison */
const RATE_TOLERANCE_LOW = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TempBasalProfile {
  current_basal: number;
  max_daily_basal: number;
  max_basal: number;
  max_daily_safety_multiplier: number | null;
  current_basal_safety_multiplier: number | null;
  skip_neutral_temps?: boolean;
  model?: string;
}

interface TempBasalResult {
  reason: string;
  duration?: number;
  rate?: number;
}

interface CurrentTemp {
  duration: number;
  rate: number;
}

interface TempBasalFunctionsInterface {
  getMaxSafeBasal: (profile: TempBasalProfile) => number;
  setTempBasal: (
    rate: number,
    duration: number,
    profile: TempBasalProfile,
    requestedTempBasalResult: TempBasalResult,
    currenttemp?: CurrentTemp,
  ) => TempBasalResult;
}

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/** Calculate the maximum safe basal rate from profile safety constraints */
function getMaxSafeBasal(profile: TempBasalProfile): number {
    const dailyMultiplier = resolveMultiplier(
        profile.max_daily_safety_multiplier,
        DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER,
    );
    const currentMultiplier = resolveMultiplier(
        profile.current_basal_safety_multiplier,
        DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER,
    );

    return Math.min(
        profile.max_basal,
        dailyMultiplier * profile.max_daily_basal,
        currentMultiplier * profile.current_basal,
    );
}

/** Set or cancel a temp basal, enforcing safety limits and tolerance checks */
function setTempBasal(
    rate: number,
    duration: number,
    profile: TempBasalProfile,
    requestedTempBasalResult: TempBasalResult,
    currenttemp?: CurrentTemp,
): TempBasalResult {
    const clampedRate = Math.min(Math.max(0, rate), getMaxSafeBasal(profile));
    const suggestedRate = round_basal(clampedRate, profile);

    // If a current temp is running and close enough to the suggestion, keep it
    if (currenttemp?.duration != null && currenttemp?.rate != null
        && isCurrentTempAcceptable(currenttemp, suggestedRate, duration)) {
        requestedTempBasalResult.reason += ` ${currenttemp.duration}m left and ${currenttemp.rate} ~ req ${suggestedRate}U/hr: no temp required`;
        return requestedTempBasalResult;
    }

    // When suggested rate matches the profile rate, handle neutral temp logic
    if (suggestedRate === profile.current_basal) {
        if (profile.skip_neutral_temps) {
            if (currenttemp?.duration != null && currenttemp.duration > 0) {
                appendReason(requestedTempBasalResult, 'Suggested rate is same as profile rate, a temp basal is active, canceling current temp');
                requestedTempBasalResult.duration = 0;
                requestedTempBasalResult.rate = 0;
                return requestedTempBasalResult;
            }
            appendReason(requestedTempBasalResult, 'Suggested rate is same as profile rate, no temp basal is active, doing nothing');
            return requestedTempBasalResult;
        }
        appendReason(requestedTempBasalResult, `Setting neutral temp basal of ${profile.current_basal}U/hr`);
        requestedTempBasalResult.duration = duration;
        requestedTempBasalResult.rate = suggestedRate;
        return requestedTempBasalResult;
    }

    // Normal case: set the new temp basal
    requestedTempBasalResult.duration = duration;
    requestedTempBasalResult.rate = suggestedRate;
    return requestedTempBasalResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Append a message to the result reason string and log it */
function appendReason(requestedTempBasalResult: TempBasalResult, message: string): void {
    requestedTempBasalResult.reason = (requestedTempBasalResult.reason ? requestedTempBasalResult.reason + '. ' : '') + message;
    console.log(message);
}

/** Resolve a safety multiplier, falling back to the default if null or NaN */
function resolveMultiplier(value: number | null, defaultValue: number): number {
    if (value === null || isNaN(value)) {
        return defaultValue;
    }
    return value;
}

/** Check whether the current temp basal is close enough to the suggestion to keep */
function isCurrentTempAcceptable(
    currenttemp: CurrentTemp,
    suggestedRate: number,
    duration: number,
): boolean {
    return currenttemp.duration > (duration - TEMP_DURATION_TOLERANCE_MINUTES)
        && currenttemp.duration <= MAX_TEMP_BASAL_DURATION_MINUTES
        && suggestedRate <= currenttemp.rate * RATE_TOLERANCE_HIGH
        && suggestedRate >= currenttemp.rate * RATE_TOLERANCE_LOW
        && duration > 0;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const tempBasalFunctions: TempBasalFunctionsInterface = {
    getMaxSafeBasal,
    setTempBasal,
};

export default tempBasalFunctions;
export {
    tempBasalFunctions,
    getMaxSafeBasal,
    setTempBasal,
    // Helpers
    appendReason,
    resolveMultiplier,
    isCurrentTempAcceptable,
};
export type { TempBasalProfile, TempBasalResult, CurrentTemp };
