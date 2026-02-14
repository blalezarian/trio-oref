import { getCurrentBasalRate } from '../profile/basal';
import type {
    IobProfile,
    TempEvent,
} from './types';
import {
    MS_PER_MINUTE,
    EXERCISE_NORMAL_TARGET,
    EXERCISE_HALF_BASAL_TARGET,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size of each micro-bolus used to represent net basal insulin (U) */
const NET_BASAL_BOLUS_SIZE = 0.05;
/** Threshold above normalTarget to activate exercise sensitivity (mg/dL) */
const EXERCISE_ACTIVATION_OFFSET = 5;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Convert net basal rates (temp rate minus profile rate) into a series of
 * micro-bolus treatment events. Each net basal segment is split into evenly
 * spaced 0.05U micro-boluses to approximate continuous delivery.
 */
export function convertNetBasalsToTreatments(
    splitHistory: TempEvent[],
    profileData: IobProfile,
    autosens_data?: { ratio: number },
): TempEvent[] {
    const tempBoluses: TempEvent[] = [];
    let target_bg: number | undefined;

    for (let splitIdx = 0; splitIdx < splitHistory.length; splitIdx++) {

        const currentItem = splitHistory[splitIdx];

        if ((Number(currentItem.duration)) > 0) {

            let currentRate: number = profileData.current_basal;
            if (profileData.basalprofile && profileData.basalprofile.length > 0) {
                currentRate = Number(getCurrentBasalRate(profileData.basalprofile, new Date(String(currentItem.timestamp))));
            }

            if (profileData.min_bg !== undefined && profileData.max_bg !== undefined) {
                target_bg = (profileData.min_bg + profileData.max_bg) / 2;
            }
            let sensitivityRatio: number | undefined;
            const normalTarget = EXERCISE_NORMAL_TARGET; // evaluate high/low temptarget against 100, not scheduled basal (which might change)
            let halfBasalTarget: number;
            if ( profileData.half_basal_exercise_target ) {
                halfBasalTarget = profileData.half_basal_exercise_target;
            } else {
                halfBasalTarget = EXERCISE_HALF_BASAL_TARGET; // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
            }
            if ( profileData.exercise_mode && profileData.temptargetSet && Number(target_bg) >= normalTarget + EXERCISE_ACTIVATION_OFFSET ) {
                // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
                // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
                const c = halfBasalTarget - normalTarget;
                sensitivityRatio = c/(c+Number(target_bg)-normalTarget);
            } else if (autosens_data !== undefined ) {
                sensitivityRatio = autosens_data.ratio;
            }
            if ( sensitivityRatio ) {
                currentRate = currentRate * sensitivityRatio;
            }

            const netBasalRate = Number(currentItem.rate) - currentRate;
            const tempBolusSize = netBasalRate < 0 ? -NET_BASAL_BOLUS_SIZE : NET_BASAL_BOLUS_SIZE;
            const netBasalAmount = Math.round(netBasalRate*(Number(currentItem.duration))*10/6)/100
            const tempBolusCount = Math.round(netBasalAmount / tempBolusSize);
            const tempBolusSpacing = (Number(currentItem.duration)) / tempBolusCount;
            for (let bolusIdx = 0; bolusIdx < tempBolusCount; bolusIdx++) {
                const bolusDate = currentItem.date + bolusIdx * tempBolusSpacing*MS_PER_MINUTE;
                const tempBolus: TempEvent = {
                    date: bolusDate,
                    insulin: tempBolusSize,
                    created_at: new Date(bolusDate),
                };
                tempBoluses.push(tempBolus);
            }
        }
    }
    return tempBoluses;
}
