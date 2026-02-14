import {
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    TEMP_BASAL_DURATION_MINUTES,
    DEFAULT_SMB_DELIVERY_RATIO,
    DEFAULT_SMB_INTERVAL_MINUTES,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
} from '../../shared/constants';

import { roundBasal } from '../../utils/rounding';

import {
    TEMP_SHORT_DURATION_MINUTES,
    INSULIN_OVERSHOOT_FACTOR,
    LOW_TEMP_CORRECTION_FACTOR,
    MIN_SMB_INTERVAL_MINUTES,
    MAX_SMB_INTERVAL_MINUTES,
    SECONDS_PER_MINUTE,
} from '../constants';

import { round, convertBG } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';
import {
    keepOrSetBasalTemp,
    determineSMBMaxBolus,
    calculateSMBZeroTemp,
} from './helpers';

// ---------------------------------------------------------------------------
// Phase 10: checkIOBLimit
// ---------------------------------------------------------------------------

/** Checks if eventual BG is above target and if IOB exceeds max_iob. Returns basal temp if IOB is over limit. */
export function checkIOBLimit(ctx: DosingContext): PhaseOutcome {
    const {
        iobData,
        profile,
        eventualBG,
        targetBG,
        maxBG,
        maxIOB,
        adjustedSens,
    } = ctx.inputs;
    const { result } = ctx;

    // eventual BG is at/above target
    // if iob is over max, just cancel any temps
    if (eventualBG >= maxBG) {
        result.reason += `Eventual BG ${convertBG(eventualBG, profile)} >= ${convertBG(maxBG, profile)}, `;
        if (eventualBG > maxBG) {
            result.insulinForManualBolus = round((eventualBG - targetBG) / adjustedSens, 2);
        }
    }
    if (iobData.iob > maxIOB) {
        result.reason += `IOB ${round(iobData.iob, 2)} > max_iob ${maxIOB}`;
        return keepOrSetBasalTemp(ctx);
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 11: calculateHighInsulinReq
// ---------------------------------------------------------------------------

/** Computes insulinReq and rate to bring minPredBG down to target. Stores on context for SMB/temp phases. */
export function calculateHighInsulinReq(ctx: DosingContext): PhaseOutcome {
    const {
        iobData,
        profile,
        eventualBG,
        targetBG,
        maxIOB,
        basal,
        adjustedSens,
        minPredBG,
    } = ctx.inputs;
    const { result } = ctx;

    // otherwise, calculate 30m high-temp required to get projected BG down to target
    // insulinReq is the additional insulin required to get minPredBG down to target_bg
    ctx.insulinReq = round((Math.min(minPredBG, eventualBG) - targetBG) / adjustedSens, 2);
    const insulinForManualBolus = round((eventualBG - targetBG) / adjustedSens, 2);
    // if that would put us over max_iob, then reduce accordingly
    if (ctx.insulinReq > maxIOB - iobData.iob) {
        console.log(`SMB limited by maxIOB: ${maxIOB - iobData.iob} (. insulinReq: ${ctx.insulinReq} U)`);
        result.reason += `max_iob ${maxIOB}, `;
        ctx.insulinReq = maxIOB - iobData.iob;
    } else { console.log(`SMB not limited by maxIOB ( insulinReq: ${ctx.insulinReq} U).`); }

    if (insulinForManualBolus > maxIOB - iobData.iob) {
        console.log(`Ev. Bolus limited by maxIOB: ${maxIOB - iobData.iob} (. insulinForManualBolus: ${insulinForManualBolus} U)`);
        result.reason += `max_iob ${maxIOB}, `;
    } else { console.log(`Ev. Bolus would not be limited by maxIOB ( insulinForManualBolus: ${insulinForManualBolus} U).`); }

    // rate required to deliver insulinReq more insulin over 30m:
    ctx.rate = basal + (LOW_TEMP_CORRECTION_FACTOR * ctx.insulinReq);
    ctx.rate = roundBasal(ctx.rate, profile);
    ctx.insulinReq = round(ctx.insulinReq, 3);
    result.insulinReq = ctx.insulinReq;

    return { done: false };
}

// ---------------------------------------------------------------------------
// Phase 12: handleSMB
// ---------------------------------------------------------------------------

/** Calculates SMB microBolus amount, zero-temp duration, and SMB timing. Returns early if zero temp is needed. */
export function handleSMB(ctx: DosingContext): PhaseOutcome {
    const {
        iobData,
        mealData,
        profile,
        systemTime,
        trioCustomVariables,
        microBolusAllowed,
        bg,
        targetBG,
        threshold,
        basal,
        carbRatio,
        adjustedSens,
        overrideFactor,
        naiveEventualBG,
        minIOBPredBG,
    } = ctx.inputs;
    const { result } = ctx;

    // minutes since last bolus
    const lastBolusAge = round((systemTime.getTime() - Number(iobData.lastBolusTime)) / MS_PER_MINUTE, 1);

    if (!(microBolusAllowed && ctx.enableSMB && bg > threshold)) {
        return { done: false };
    }

    // --- Resolve SMB/UAM minute settings ---
    const { smbMinutesSetting, uamMinutesSetting } = resolveSMBMinuteSettings(profile, trioCustomVariables);

    // --- Calculate max bolus and micro bolus ---
    const mealInsulinReq = round(mealData.mealCOB / carbRatio, 3);
    const effectiveBasal = profile.current_basal * overrideFactor;
    const maxBolus = determineSMBMaxBolus(
        ctx.insulinReq,
        iobData.iob,
        mealData.mealCOB,
        mealInsulinReq,
        effectiveBasal,
        smbMinutesSetting,
        uamMinutesSetting,
    );

    const bolusIncrement = Number(profile.bolus_increment);
    const roundSMBTo = 1 / bolusIncrement;
    const smb_ratio = Math.min(Number(profile.smb_delivery_ratio), 1);
    if (smb_ratio != DEFAULT_SMB_DELIVERY_RATIO) {
        console.log(`SMB Delivery Ratio changed from default 0.5 to ${round(smb_ratio, 2)}`);
    }
    const microBolus = Math.floor(Math.min(ctx.insulinReq * smb_ratio, maxBolus) * roundSMBTo) / roundSMBTo;

    // --- Calculate zero-temp duration ---
    const worstCaseInsulinReq = (targetBG - (naiveEventualBG + minIOBPredBG) / 2) / adjustedSens;
    const { durationReq, smbLowTempReq } = calculateSMBZeroTemp(
        ctx.insulinReq,
        microBolus,
        bolusIncrement,
        worstCaseInsulinReq,
        profile.current_basal,
        overrideFactor,
        basal,
    );

    // --- Build reason string ---
    result.reason += ` insulinReq ${ctx.insulinReq}`;
    if (microBolus >= maxBolus) {
        result.reason += `; maxBolus ${maxBolus}`;
    }
    if (durationReq > 0) {
        result.reason += `; setting ${durationReq}m low temp of ${smbLowTempReq}U/h`;
    }
    result.reason += ". ";

    // --- Check SMB timing interval ---
    const smbInterval = resolveSMBInterval(profile);
    const nextBolusMins = round(smbInterval - lastBolusAge, 0);
    const nextBolusSeconds = round((smbInterval - lastBolusAge) * SECONDS_PER_MINUTE, 0) % SECONDS_PER_MINUTE;
    console.log(`naive_eventualBG ${naiveEventualBG},${durationReq}m ${smbLowTempReq}U/h temp needed; last bolus ${lastBolusAge}m ago; maxBolus: ${maxBolus}`);

    if (lastBolusAge > smbInterval) {
        if (microBolus > 0) {
            result.units = microBolus;
            result.reason += `Microbolusing ${microBolus}U. `;
        }
    } else {
        result.reason += `Waiting ${nextBolusMins}m ${nextBolusSeconds}s to microbolus again. `;
    }

    // if no zero temp is required, don't return yet; allow later code to set a high temp
    if (durationReq > 0) {
        result.rate = smbLowTempReq;
        result.duration = durationReq;
        return { done: true, result };
    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// handleSMB helpers
// ---------------------------------------------------------------------------

/** Resolves effective SMB and UAM minute settings from profile + override. */
export function resolveSMBMinuteSettings(
    profile: DosingContext['inputs']['profile'],
    trioCustomVariables: DosingContext['inputs']['trioCustomVariables'],
): { smbMinutesSetting: number; uamMinutesSetting: number } {
    const { advancedSettings, smbMinutes, uamMinutes } = trioCustomVariables;

    let smbMinutesSetting = profile.maxSMBBasalMinutes ?? DEFAULT_MAX_SMB_BASAL_MINUTES;
    let uamMinutesSetting = profile.maxUAMSMBBasalMinutes ?? DEFAULT_MAX_SMB_BASAL_MINUTES;

    if (trioCustomVariables.useOverride && advancedSettings && smbMinutes !== smbMinutesSetting) {
        console.log(`SMB Max Minutes - setting overriden from ${smbMinutesSetting} to ${smbMinutes}`);
        smbMinutesSetting = smbMinutes;
    }
    if (trioCustomVariables.useOverride && advancedSettings && uamMinutes !== uamMinutesSetting) {
        console.log(`UAM Max Minutes - setting overriden from ${uamMinutesSetting} to ${uamMinutes}`);
        uamMinutesSetting = uamMinutes;
    }

    return { smbMinutesSetting, uamMinutesSetting };
}

/** Resolves the effective SMB interval from profile, clamped to [1, 10] minutes. */
export function resolveSMBInterval(
    profile: DosingContext['inputs']['profile'],
): number {
    if (profile.SMBInterval) {
        return Math.min(MAX_SMB_INTERVAL_MINUTES, Math.max(MIN_SMB_INTERVAL_MINUTES, profile.SMBInterval));
    }
    return DEFAULT_SMB_INTERVAL_MINUTES;
}

// ---------------------------------------------------------------------------
// Phase 13: applyFinalHighTemp
// ---------------------------------------------------------------------------

/** Caps rate at maxSafeBasal and compares to current temp to decide whether to set, keep, or raise. */
export function applyFinalHighTemp(ctx: DosingContext): PhaseOutcome {
    const {
        profile,
        currenttemp,
        tempBasalFunctions,
        basal,
    } = ctx.inputs;
    const { result } = ctx;

    const maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

    if (ctx.rate > maxSafeBasal) {
        result.reason += `adj. req. rate: ${ctx.rate} to maxSafeBasal: ${round(maxSafeBasal, 2)}, `;
        ctx.rate = roundBasal(maxSafeBasal, profile);
    }

    ctx.insulinScheduled = currenttemp.duration * (currenttemp.rate - basal) / MINUTES_PER_HOUR;
    if (ctx.insulinScheduled >= ctx.insulinReq * INSULIN_OVERSHOOT_FACTOR) { // if current temp would deliver >2x more than the required insulin, lower the rate
        result.reason += `${currenttemp.duration}m@${(currenttemp.rate).toFixed(2)} > 2 * insulinReq. Setting temp basal of ${ctx.rate}U/hr. `;
        return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
    }

    if (currenttemp.duration === undefined || currenttemp.duration === 0) { // no temp is set
        result.reason += `no temp, setting ${ctx.rate}U/hr. `;
        return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
    }

    if (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && (roundBasal(ctx.rate, profile) <= roundBasal(currenttemp.rate, profile))) { // if required temp <~ existing temp basal
        result.reason += `temp ${currenttemp.rate} >~ req ${ctx.rate}U/hr. `;
        return { done: true, result };
    }

    // required temp > existing temp basal
    result.reason += `temp ${currenttemp.rate}<${ctx.rate}U/hr. `;
    return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
}
