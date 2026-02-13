import {
    MINUTES_PER_HOUR,
    TEMP_BASAL_DURATION_MINUTES,
} from '../../shared/constants';

import {
    IOB_NEG_CHECK_MINUTES,
    DEFAULT_MAX_DELTA_BG_THRESHOLD,
    MAX_DELTA_BG_THRESHOLD_CAP,
    TOP_OF_HOUR_WINDOW_MINUTES,
    BOLUS_ERR_GUARD_BELOW_THRESHOLD,
    BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD,
} from '../constants';

import { round, convert_bg } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';
import { calculateZeroTempDuration } from './helpers';

// ---------------------------------------------------------------------------
// Phase 3: enforceSMBSafetyGuards
// ---------------------------------------------------------------------------

/** Disables SMB if minGuardBG is below threshold or if maxDelta indicates a sudden BG spike. */
export function enforceSMBSafetyGuards(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        minGuardBG,
        threshold,
        bg,
        maxDelta,
        adjustedSens,
    } = ctx.inputs;
    const { result } = ctx;

    if (ctx.enableSMB && minGuardBG < threshold) {
        console.error(`minGuardBG ${convert_bg(minGuardBG, profile)} projected below ${convert_bg(threshold, profile)} - disabling SMB`);
        result.manualBolusErrorString = BOLUS_ERR_GUARD_BELOW_THRESHOLD;
        result.minGuardBG = minGuardBG;
        result.insulinForManualBolus = round(((result.eventualBG as number) - (result.target_bg as number)) / adjustedSens, 2);

        ctx.enableSMB = false;
    }

    // Disable SMB for sudden rises (often caused by calibrations or activation/deactivation of Dexcom's noise-filtering algorithm)
    // Added maxDelta_bg_threshold as a hidden preference and included a cap at 0.4 as a safety limit
    const maxDelta_bg_threshold = profile.maxDelta_bg_threshold !== undefined
        ? Math.min(profile.maxDelta_bg_threshold, MAX_DELTA_BG_THRESHOLD_CAP)
        : DEFAULT_MAX_DELTA_BG_THRESHOLD;
    if (maxDelta > maxDelta_bg_threshold * bg) {
        console.error(`maxDelta ${convert_bg(maxDelta, profile)} > ${100 * maxDelta_bg_threshold}% of BG ${convert_bg(bg, profile)} - disabling SMB`);
        result.reason += `maxDelta ${convert_bg(maxDelta, profile)} > ${100 * maxDelta_bg_threshold}% of BG ${convert_bg(bg, profile)} - SMB disabled!, `;
        ctx.enableSMB = false;
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 5: checkPredictiveLGS
// ---------------------------------------------------------------------------

/** Low glucose suspend: sets a zero temp if BG is or is projected to be below threshold. */
export function checkPredictiveLGS(ctx: DosingContext): PhaseOutcome {
    const {
        iob_data,
        profile,
        currenttemp,
        tempBasalFunctions,
        bg,
        threshold,
        target_bg,
        eventualBG,
        minGuardBG,
        minDelta,
        expectedDelta,
        adjustedSens,
        overrideFactor,
    } = ctx.inputs;
    const { result } = ctx;

    // don't low glucose suspend if IOB is already super negative and BG is rising faster than predicted
    if (bg < threshold && iob_data.iob < -profile.current_basal * overrideFactor * IOB_NEG_CHECK_MINUTES / MINUTES_PER_HOUR && minDelta > 0 && minDelta > expectedDelta) {
        result.reason += `IOB ${iob_data.iob} < ${round(-profile.current_basal * overrideFactor * IOB_NEG_CHECK_MINUTES / MINUTES_PER_HOUR, 2)}`;
        result.reason += ` and minDelta ${convert_bg(minDelta, profile)} > expectedDelta ${convert_bg(expectedDelta, profile)}; `;
    // predictive low glucose suspend mode: BG is / is projected to be < threshold
    } else if (bg < threshold || minGuardBG < threshold) {
        result.reason += `minGuardBG ${convert_bg(minGuardBG, profile)}<${convert_bg(threshold, profile)}`;
        const bgUndershoot = target_bg - minGuardBG;

        if (minGuardBG < threshold) {
            result.manualBolusErrorString = BOLUS_ERR_LGS_GUARD_BELOW_THRESHOLD;
            result.minGuardBG = minGuardBG;
        }
        result.insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);

        // always set a 30-120m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
        const durationReq = calculateZeroTempDuration(bgUndershoot, adjustedSens, profile.current_basal, overrideFactor, TEMP_BASAL_DURATION_MINUTES);
        return { done: true, result: tempBasalFunctions.setTempBasal(0, durationReq, profile, result, currenttemp) };
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 6: checkTopOfHourCancel
// ---------------------------------------------------------------------------

/** Cancels temp at top of hour to reduce beeping/vibration (non-SMB mode only). */
export function checkTopOfHourCancel(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        currenttemp,
        tempBasalFunctions,
    } = ctx.inputs;
    const { result } = ctx;

    if (profile.skip_neutral_temps && (result.deliverAt as unknown as Date).getMinutes() >= TOP_OF_HOUR_WINDOW_MINUTES) {
        if (!ctx.enableSMB) {
            result.reason += `; Canceling temp at ${MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()}min before turn of the hour to avoid beeping of MDT. SMB are disabled anyways.`;
            return { done: true, result: tempBasalFunctions.setTempBasal(0, 0, profile, result, currenttemp) };
        } else {
            console.error(`${MINUTES_PER_HOUR - (result.deliverAt as unknown as Date).getMinutes()}min before turn of the hour, but SMB's are enabled - not skipping neutral temps.`);
        }
    }

    return { done: false };
}
