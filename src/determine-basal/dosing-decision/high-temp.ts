import {
    MINUTES_PER_HOUR,
    MS_PER_MINUTE,
    TEMP_BASAL_DURATION_MINUTES,
    DEFAULT_SMB_DELIVERY_RATIO,
    DEFAULT_SMB_INTERVAL_MINUTES,
    DEFAULT_MAX_SMB_BASAL_MINUTES,
} from '../../shared/constants';

import { round_basal } from '../../utils/round-basal';

import {
    TEMP_SHORT_DURATION_MINUTES,
    INSULIN_OVERSHOOT_FACTOR,
    LOW_TEMP_CORRECTION_FACTOR,
    MIN_SMB_INTERVAL_MINUTES,
    MAX_SMB_INTERVAL_MINUTES,
    SMB_MAX_ZERO_TEMP_MINUTES,
    SECONDS_PER_MINUTE,
} from '../constants';

import { round, convert_bg } from '../helpers';

import type { DosingContext, PhaseOutcome } from './types';
import { keepOrSetBasalTemp } from './helpers';

// ---------------------------------------------------------------------------
// Phase 10: checkIOBLimit
// ---------------------------------------------------------------------------

/** Checks if eventual BG is above target and if IOB exceeds max_iob. Returns basal temp if IOB is over limit. */
export function checkIOBLimit(ctx: DosingContext): PhaseOutcome {
    const {
        iob_data,
        profile,
        currenttemp,
        tempBasalFunctions,
        eventualBG,
        target_bg,
        max_bg,
        max_iob,
        basal,
        adjustedSens,
    } = ctx.inputs;
    const { result } = ctx;

    // eventual BG is at/above target
    // if iob is over max, just cancel any temps
    if (eventualBG >= max_bg) {
        result.reason += `Eventual BG ${convert_bg(eventualBG, profile)} >= ${convert_bg(max_bg, profile)}, `;
        if (eventualBG > max_bg) {
            result.insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
        }
    }
    if (iob_data.iob > max_iob) {
        result.reason += `IOB ${round(iob_data.iob, 2)} > max_iob ${max_iob}`;
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
        iob_data,
        profile,
        eventualBG,
        target_bg,
        max_iob,
        basal,
        adjustedSens,
        overrideFactor,
        minPredBG,
    } = ctx.inputs;
    const { result } = ctx;

    // otherwise, calculate 30m high-temp required to get projected BG down to target
    // insulinReq is the additional insulin required to get minPredBG down to target_bg
    ctx.insulinReq = round((Math.min(minPredBG, eventualBG) - target_bg) / adjustedSens, 2);
    const insulinForManualBolus = round((eventualBG - target_bg) / adjustedSens, 2);
    // if that would put us over max_iob, then reduce accordingly
    if (ctx.insulinReq > max_iob - iob_data.iob) {
        console.error(`SMB limited by maxIOB: ${max_iob - iob_data.iob} (. insulinReq: ${ctx.insulinReq} U)`);
        result.reason += `max_iob ${max_iob}, `;
        ctx.insulinReq = max_iob - iob_data.iob;
    } else { console.error(`SMB not limited by maxIOB ( insulinReq: ${ctx.insulinReq} U).`); }

    if (insulinForManualBolus > max_iob - iob_data.iob) {
        console.error(`Ev. Bolus limited by maxIOB: ${max_iob - iob_data.iob} (. insulinForManualBolus: ${insulinForManualBolus} U)`);
        result.reason += `max_iob ${max_iob}, `;
    } else { console.error(`Ev. Bolus would not be limited by maxIOB ( insulinForManualBolus: ${insulinForManualBolus} U).`); }

    // rate required to deliver insulinReq more insulin over 30m:
    ctx.rate = basal + (LOW_TEMP_CORRECTION_FACTOR * ctx.insulinReq);
    ctx.rate = round_basal(ctx.rate, profile);
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
        iob_data,
        profile,
        microBolusAllowed,
        systemTime,
        bg,
        threshold,
        naive_eventualBG,
    } = ctx.inputs;
    const { result } = ctx;

    // minutes since last bolus
    const lastBolusAge = round((new Date(systemTime).getTime() - (iob_data.lastBolusTime as number)) / MS_PER_MINUTE, 1);

    // only allow microboluses with COB or low temp targets, or within DIA hours of a bolus
    if (microBolusAllowed && ctx.enableSMB && bg > threshold) {
        const maxBolus = calculateSMBMaxBolus(ctx);

        // bolus 1/2 the insulinReq, up to maxBolus, rounding down to nearest bolus increment
        const bolusIncrement = profile.bolus_increment as number;
        const roundSMBTo = 1 / bolusIncrement;

        const smb_ratio = Math.min(profile.smb_delivery_ratio as number, 1);

        if (smb_ratio != DEFAULT_SMB_DELIVERY_RATIO) {
            console.error(`SMB Delivery Ratio changed from default 0.5 to ${round(smb_ratio, 2)}`);
        }
        let microBolus = Math.min(ctx.insulinReq * smb_ratio, maxBolus);

        microBolus = Math.floor(microBolus * roundSMBTo) / roundSMBTo;

        const { durationReq, smbLowTempReq } = calculateSMBZeroTempDuration(ctx, microBolus, bolusIncrement);

        result.reason += ` insulinReq ${ctx.insulinReq}`;
        if (microBolus >= maxBolus) {
            result.reason += `; maxBolus ${maxBolus}`;
        }
        if (durationReq > 0) {
            result.reason += `; setting ${durationReq}m low temp of ${smbLowTempReq}U/h`;
        }
        result.reason += ". ";

        applySMBTiming(ctx, microBolus, maxBolus, lastBolusAge);
        console.error(`naive_eventualBG ${naive_eventualBG},${durationReq}m ${smbLowTempReq}U/h temp needed; last bolus ${lastBolusAge}m ago; maxBolus: ${maxBolus}`);

        // if no zero temp is required, don't return yet; allow later code to set a high temp
        if (durationReq > 0) {
            result.rate = smbLowTempReq;
            result.duration = durationReq;
            return { done: true, result };
        }

    }

    return { done: false };
}

// ---------------------------------------------------------------------------
// handleSMB helpers
// ---------------------------------------------------------------------------

/** Resolves SMB minutes settings with overrides and calculates maxBolus from the 3-branch selection. */
function calculateSMBMaxBolus(ctx: DosingContext): number {
    const {
        iob_data,
        meal_data,
        profile,
        trio_custom_variables,
        carbRatio,
        overrideFactor,
    } = ctx.inputs;

    const { smbMinutesSetting, uamMinutesSetting } = resolveSMBMinutesSettings(profile, trio_custom_variables);
    const mealInsulinReq = round(meal_data.mealCOB / carbRatio, 3);

    if (smbMinutesSetting === undefined) {
        return calculateDefaultMaxBolus(profile.current_basal, overrideFactor, ctx.insulinReq);
    }

    if (iob_data.iob > mealInsulinReq && iob_data.iob > 0) {
        return calculateUAMMaxBolus(profile.current_basal, overrideFactor, uamMinutesSetting, iob_data.iob, meal_data.mealCOB, mealInsulinReq, ctx.insulinReq);
    }

    return calculateSMBMinutesMaxBolus(profile.current_basal, overrideFactor, smbMinutesSetting, ctx.insulinReq);
}

/** Resolves smbMinutesSetting and uamMinutesSetting from profile defaults and override values. */
function resolveSMBMinutesSettings(
    profile: DosingContext['inputs']['profile'],
    trio_custom_variables: DosingContext['inputs']['trio_custom_variables'],
): { smbMinutesSetting: number; uamMinutesSetting: number } {
    const { advancedSettings, smbMinutes, uamMinutes } = trio_custom_variables;

    // never bolus more than maxSMBBasalMinutes worth of basal
    let smbMinutesSetting = DEFAULT_MAX_SMB_BASAL_MINUTES;
    if (profile.maxSMBBasalMinutes !== undefined) {
        smbMinutesSetting = profile.maxSMBBasalMinutes;
    }
    let uamMinutesSetting = DEFAULT_MAX_SMB_BASAL_MINUTES;
    if (profile.maxUAMSMBBasalMinutes !== undefined) {
        uamMinutesSetting = profile.maxUAMSMBBasalMinutes;
    }

    if (trio_custom_variables.useOverride && advancedSettings && smbMinutes !== smbMinutesSetting) {
        console.error(`SMB Max Minutes - setting overriden from ${smbMinutesSetting} to ${smbMinutes}`);
        smbMinutesSetting = smbMinutes;
    }
    if (trio_custom_variables.useOverride && advancedSettings && uamMinutes !== uamMinutesSetting) {
        console.error(`UAM Max Minutes - setting overriden from ${uamMinutesSetting} to ${uamMinutes}`);
        uamMinutesSetting = uamMinutes;
    }

    return { smbMinutesSetting, uamMinutesSetting };
}

/** maxBolus when smbMinutesSetting is undefined: default to 30m worth of basal. */
function calculateDefaultMaxBolus(current_basal: number, overrideFactor: number, insulinReq: number): number {
    const maxBolus = round(current_basal * overrideFactor * DEFAULT_MAX_SMB_BASAL_MINUTES / MINUTES_PER_HOUR, 1);
    console.error("smbMinutesSetting undefined: defaulting to 30m");
    if (insulinReq > maxBolus) {
        console.error(`SMB limited by maxBolus: ${maxBolus} ( ${insulinReq} U)`);
    }
    return maxBolus;
}

/** maxBolus when IOB exceeds meal insulin requirement: use UAM minutes setting. */
function calculateUAMMaxBolus(
    current_basal: number,
    overrideFactor: number,
    uamMinutesSetting: number,
    iob: number,
    mealCOB: number,
    mealInsulinReq: number,
    insulinReq: number,
): number {
    console.error(`IOB${iob}> COB${mealCOB}; mealInsulinReq =${mealInsulinReq}`);
    const effectiveMinutes = uamMinutesSetting || DEFAULT_MAX_SMB_BASAL_MINUTES;
    if (uamMinutesSetting) {
        console.error(`maxUAMSMBBasalMinutes: ${uamMinutesSetting}, profile.current_basal: ${current_basal * overrideFactor}`);
    } else {
        console.error("maxUAMSMBBasalMinutes undefined: defaulting to 30m");
    }
    const maxBolus = round(current_basal * overrideFactor * effectiveMinutes / MINUTES_PER_HOUR, 1);
    if (insulinReq > maxBolus) {
        console.error(`SMB limited by maxUAMSMBBasalMinutes [ ${uamMinutesSetting}m ]: ${maxBolus}U ( ${insulinReq}U )`);
    } else { console.error(`SMB is not limited by maxUAMSMBBasalMinutes. ( insulinReq: ${insulinReq}U )`); }
    return maxBolus;
}

/** maxBolus for normal SMB path: use smbMinutesSetting. */
function calculateSMBMinutesMaxBolus(current_basal: number, overrideFactor: number, smbMinutesSetting: number, insulinReq: number): number {
    console.error(`.maxSMBBasalMinutes: ${smbMinutesSetting}, profile.current_basal: ${current_basal * overrideFactor}`);
    const maxBolus = round(current_basal * overrideFactor * smbMinutesSetting / MINUTES_PER_HOUR, 1);
    if (insulinReq > maxBolus) {
        console.error(`SMB limited by maxSMBBasalMinutes: ${smbMinutesSetting}m ]: ${maxBolus}U ( insulinReq: ${insulinReq}U )`);
    } else { console.error(`SMB is not limited by maxSMBBasalMinutes. ( insulinReq: ${insulinReq}U )`); }
    return maxBolus;
}

/** Calculates zero-temp duration for SMB and clamps to valid range. */
function calculateSMBZeroTempDuration(
    ctx: DosingContext,
    microBolus: number,
    bolusIncrement: number,
): { durationReq: number; smbLowTempReq: number } {
    const {
        profile,
        target_bg,
        basal,
        adjustedSens,
        overrideFactor,
        naive_eventualBG,
        minIOBPredBG,
    } = ctx.inputs;

    // calculate a long enough zero temp to eventually correct back up to target
    const smbTarget = target_bg;
    const worstCaseInsulinReq = (smbTarget - (naive_eventualBG + minIOBPredBG) / 2) / adjustedSens;
    let durationReq = round(MINUTES_PER_HOUR * worstCaseInsulinReq / profile.current_basal * overrideFactor);

    // if insulinReq > 0 but not enough for a microBolus, don't set an SMB zero temp
    if (ctx.insulinReq > 0 && microBolus < bolusIncrement) {
        return { durationReq: 0, smbLowTempReq: 0 };
    }

    if (durationReq <= 0) {
        return { durationReq: 0, smbLowTempReq: 0 };
    }

    // don't set an SMB zero temp longer than 60 minutes
    if (durationReq >= TEMP_BASAL_DURATION_MINUTES) {
        durationReq = round(durationReq / TEMP_BASAL_DURATION_MINUTES) * TEMP_BASAL_DURATION_MINUTES;
        durationReq = Math.min(SMB_MAX_ZERO_TEMP_MINUTES, Math.max(0, durationReq));
        return { durationReq, smbLowTempReq: 0 };
    }

    // if SMB durationReq is less than 30m, set a nonzero low temp
    const smbLowTempReq = round(basal * durationReq / TEMP_BASAL_DURATION_MINUTES, 2);
    return { durationReq: TEMP_BASAL_DURATION_MINUTES, smbLowTempReq };
}

/** Checks SMB interval timing and sets result.units/reason if a microBolus should be delivered. */
function applySMBTiming(
    ctx: DosingContext,
    microBolus: number,
    maxBolus: number,
    lastBolusAge: number,
): void {
    const { profile } = ctx.inputs;
    const { result } = ctx;

    //allow SMBs every 3 minutes by default
    let SMBInterval = DEFAULT_SMB_INTERVAL_MINUTES;
    if (profile.SMBInterval) {
        // allow SMBIntervals between 1 and 10 minutes
        SMBInterval = Math.min(MAX_SMB_INTERVAL_MINUTES, Math.max(MIN_SMB_INTERVAL_MINUTES, profile.SMBInterval));
    }
    const nextBolusMins = round(SMBInterval - lastBolusAge, 0);
    const nextBolusSeconds = round((SMBInterval - lastBolusAge) * SECONDS_PER_MINUTE, 0) % SECONDS_PER_MINUTE;

    if (lastBolusAge > SMBInterval) {
        if (microBolus > 0) {
            result.units = microBolus;
            result.reason += `Microbolusing ${microBolus}U. `;
        }
    } else {
        result.reason += `Waiting ${nextBolusMins}m ${nextBolusSeconds}s to microbolus again. `;
    }
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
        ctx.rate = round_basal(maxSafeBasal, profile);
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

    if (currenttemp.duration > TEMP_SHORT_DURATION_MINUTES && (round_basal(ctx.rate, profile) <= round_basal(currenttemp.rate, profile))) { // if required temp <~ existing temp basal
        result.reason += `temp ${currenttemp.rate} >~ req ${ctx.rate}U/hr. `;
        return { done: true, result };
    }

    // required temp > existing temp basal
    result.reason += `temp ${currenttemp.rate}<${ctx.rate}U/hr. `;
    return { done: true, result: tempBasalFunctions.setTempBasal(ctx.rate, TEMP_BASAL_DURATION_MINUTES, profile, result, currenttemp) };
}
