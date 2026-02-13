import {
    MINUTES_PER_HOUR,
    TEMP_BASAL_DURATION_MINUTES,
} from '../../shared/constants';

import { round_basal } from '../../utils/round-basal';

import {
    TEMP_SHORT_DURATION_MINUTES,
    RATE_TOLERANCE_LOW,
    BASAL_SHORTFALL_FRACTION,
    LOW_TEMP_CORRECTION_FACTOR,
    LOW_BG_SAFETY_THRESHOLD,
    DELTA_SIGNIFICANCE_THRESHOLD,
    BOLUS_ERR_RISING_SLOWER,
    BOLUS_ERR_FALLING_OR_MIXED,
    BOLUS_ERR_OTHER_DELTA,
    BOLUS_ERR_MIN_PRED_BELOW_MIN,
} from '../constants';

import { round, convert_bg } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';
import { keepOrSetBasalTemp, calculateZeroTempDuration } from './helpers';

// ---------------------------------------------------------------------------
// Phase 7: handleLowBG
// ---------------------------------------------------------------------------

/** Handles BG below min_bg: calculates low temp rate, zero temp duration, or returns basal. */
export function handleLowBG(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        glucose_status,
        currenttemp,
        tempBasalFunctions,
        eventualBG,
        naive_eventualBG,
        min_bg,
        target_bg,
        basal,
        adjustedSens,
        overrideFactor,
        expectedDelta,
        minDelta,
        tick,
    } = ctx.inputs;
    const { result } = ctx;

    if (eventualBG < min_bg) { // if eventual BG is below target:
        result.reason += `Eventual BG ${convert_bg(eventualBG, profile)} < ${convert_bg(min_bg, profile)}`;
        // if 5m or 30m avg BG is rising faster than expected delta
        if (minDelta > expectedDelta && minDelta > 0 && !ctx.carbsReq) {
            // if naive_eventualBG < 40, set a 30m zero temp (oref0-pump-loop will let any longer SMB zero temp run)
            if (naive_eventualBG < LOW_BG_SAFETY_THRESHOLD) {
                result.reason += ", naive_eventualBG < 40. ";
                return { done: true, result: tempBasalFunctions.setTempBasal(0, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
            }
            if (glucose_status.delta > minDelta) {
                result.reason += `, but Delta ${convert_bg(tick as number, profile)} > expectedDelta ${convert_bg(expectedDelta, profile)}`;
            } else {
                result.reason += `, but Min. Delta ${minDelta.toFixed(2)} > Exp. Delta ${convert_bg(expectedDelta, profile)}`;
            }
            return keepOrSetBasalTemp(ctx);
        }

        // calculate 30m low-temp required to get projected BG up to target
        // multiply by 2 to low-temp faster for increased hypo safety
        ctx.insulinReq = LOW_TEMP_CORRECTION_FACTOR * Math.min(0, (eventualBG - target_bg) / adjustedSens);
        ctx.insulinReq = round(ctx.insulinReq, 2);
        // calculate naiveInsulinReq based on naive_eventualBG
        let naiveInsulinReq = Math.min(0, (naive_eventualBG - target_bg) / adjustedSens);
        naiveInsulinReq = round(naiveInsulinReq, 2);
        if (minDelta < 0 && minDelta > expectedDelta) {
            // if we're barely falling, newinsulinReq should be barely negative
            const newinsulinReq = round((ctx.insulinReq * (minDelta / expectedDelta)), 2);
            ctx.insulinReq = newinsulinReq;
        }
        // rate required to deliver insulinReq less insulin over 30m:
        ctx.rate = basal + (LOW_TEMP_CORRECTION_FACTOR * ctx.insulinReq);
        ctx.rate = round_basal(ctx.rate, profile);

        // if required temp < existing temp basal
        ctx.insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
        // if current temp would deliver a lot (30% of basal) less than the required insulin,
        // by both normal and naive calculations, then raise the rate
        const minInsulinReq = Math.min(ctx.insulinReq, naiveInsulinReq);

        console.log(`naiveInsulinReq:${naiveInsulinReq}`);

        if (ctx.insulinScheduled < minInsulinReq - basal * BASAL_SHORTFALL_FRACTION) {
            result.reason += `, ${currenttemp.duration}m@${(currenttemp.rate).toFixed(2)} is a lot less than needed. `;
            return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
        }
        if (currenttemp.rate !== undefined && (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && ctx.rate >= currenttemp.rate * RATE_TOLERANCE_LOW)) {
            result.reason += `, temp ${currenttemp.rate} ~< req ${ctx.rate}U/hr. `;
            return { done: true, result };
        }

        else {
            // calculate a long enough zero temp to eventually correct back up to target
            if (ctx.rate <= 0) {
                const durationReq = calculateZeroTempDuration(target_bg - naive_eventualBG, adjustedSens, profile.current_basal, overrideFactor);
                if (durationReq > 0) {
                    result.reason += `, setting ${durationReq}m zero temp. `;
                    return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, durationReq, profile, result, currenttemp) };
                }
            }

            else {
                result.reason += `, setting ${ctx.rate}U/hr. `;
            }
            return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
        }
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 8: handleFallingDelta
// ---------------------------------------------------------------------------

/** Handles BG above min_bg but falling faster than expected delta. Sets basal temp or continues to SMB. */
export function handleFallingDelta(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        glucose_status,
        microBolusAllowed,
        eventualBG,
        min_bg,
        adjustedSens,
        expectedDelta,
        minDelta,
        tick,
    } = ctx.inputs;
    const { result } = ctx;

    // if eventual BG is above min_bg but BG is falling faster than expected Delta
    if (minDelta < expectedDelta) {

        result.minDelta = minDelta;
        result.expectedDelta = expectedDelta;

        //Describe how the glucose is changing
        if (expectedDelta - minDelta >= DELTA_SIGNIFICANCE_THRESHOLD || (expectedDelta + (-1 * minDelta) >= DELTA_SIGNIFICANCE_THRESHOLD)) {
            if (minDelta >= 0 && expectedDelta > 0) {
                result.manualBolusErrorString = BOLUS_ERR_RISING_SLOWER;
            }
            else if ((minDelta < 0 && expectedDelta <= 0) || (minDelta < 0 && expectedDelta >= 0)) {
                result.manualBolusErrorString = BOLUS_ERR_FALLING_OR_MIXED;
            }
            else {
                result.manualBolusErrorString = BOLUS_ERR_OTHER_DELTA;
            }
        }

        result.insulinForManualBolus = round(((result.eventualBG as number) - (result.target_bg as number)) / adjustedSens, 2);

        // if in SMB mode, don't cancel SMB zero temp
        if (!(microBolusAllowed && ctx.enableSMB)) {
            if (glucose_status.delta < minDelta) {
                result.reason += `Eventual BG ${convert_bg(eventualBG, profile)} > ${convert_bg(min_bg, profile)} but Delta ${convert_bg(tick as number, profile)} < Exp. Delta ${convert_bg(expectedDelta, profile)}`;
            } else {
                result.reason += `Eventual BG ${convert_bg(eventualBG, profile)} > ${convert_bg(min_bg, profile)} but Min. Delta ${minDelta.toFixed(2)} < Exp. Delta ${convert_bg(expectedDelta, profile)}`;
            }
            return keepOrSetBasalTemp(ctx);
        }
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 9: handleInRange
// ---------------------------------------------------------------------------

/** Handles BG in range (eventualBG or minPredBG below max_bg). Cancels temp in non-SMB mode. */
export function handleInRange(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        microBolusAllowed,
        eventualBG,
        min_bg,
        max_bg,
        adjustedSens,
        minPredBG,
    } = ctx.inputs;
    const { result } = ctx;

    // eventualBG or minPredBG is below max_bg
    if (Math.min(eventualBG, minPredBG) < max_bg) {
        if (minPredBG < min_bg && eventualBG > min_bg) {
            result.manualBolusErrorString = BOLUS_ERR_MIN_PRED_BELOW_MIN;
            result.insulinForManualBolus = round(((result.eventualBG as number) - (result.target_bg as number)) / adjustedSens, 2);
        }

        // Moving this out of the if condition in L1429, so that minPredBG is becomes always available in result object (aka Trio's determination)
        result.minPredBG = minPredBG;

        // if in SMB mode, don't cancel SMB zero temp
        if (!(microBolusAllowed && ctx.enableSMB)) {
            result.reason += `${convert_bg(eventualBG, profile)}-${convert_bg(minPredBG, profile)} in range: no temp required`;
            return keepOrSetBasalTemp(ctx);
        }
    }

    return { done: false };
}
