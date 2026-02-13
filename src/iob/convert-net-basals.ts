
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

export function convertNetBasalsToTreatments(
    splitHistory: TempEvent[],
    profileData: IobProfile,
    autosens_data?: { ratio: number },
): TempEvent[] {
    const tempBoluses: TempEvent[] = [];
    let tempBolusSize;
    let target_bg: number | undefined;

    for (let i=0; i < splitHistory.length; i++) {

        const currentItem = splitHistory[i];

        if ((currentItem.duration as number) > 0) {

            let currentRate: number = profileData.current_basal;
            if (profileData.basalprofile && profileData.basalprofile.length > 0) {
                currentRate = getCurrentBasalRate(profileData.basalprofile,new Date(currentItem.timestamp as string)) as number;
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
            if ( profileData.exercise_mode && profileData.temptargetSet && (target_bg as number) >= normalTarget + 5 ) {
                // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
                // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
                const c = halfBasalTarget - normalTarget;
                sensitivityRatio = c/(c+(target_bg as number)-normalTarget);
            } else if (autosens_data !== undefined ) {
                sensitivityRatio = autosens_data.ratio;
            }
            if ( sensitivityRatio ) {
                currentRate = currentRate * sensitivityRatio;
            }

            const netBasalRate = (currentItem.rate as number) - currentRate;
            if (netBasalRate < 0) { tempBolusSize = -0.05; }
            else { tempBolusSize = 0.05; }
            const netBasalAmount = Math.round(netBasalRate*(currentItem.duration as number)*10/6)/100
            const tempBolusCount = Math.round(netBasalAmount / tempBolusSize);
            const tempBolusSpacing = (currentItem.duration as number) / tempBolusCount;
            for (let j=0; j < tempBolusCount; j++) {
                const bolusDate = currentItem.date + j * tempBolusSpacing*MS_PER_MINUTE;
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
