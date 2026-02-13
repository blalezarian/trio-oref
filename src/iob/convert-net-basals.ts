
import { getCurrentBasalRate } from '../profile/basal';
import _ from 'lodash';
import type {
    IobProfile,
    TempEvent,
} from './types';
import {
    MS_PER_MINUTE,
    EXERCISE_NORMAL_TARGET,
    EXERCISE_HALF_BASAL_TARGET,
} from '../constants';

export function convertNetBasalsToTreatments(
    splitHistory: TempEvent[],
    profile_data: IobProfile,
    autosens_data?: { ratio: number },
): TempEvent[] {
    const tempBoluses: TempEvent[] = [];
    let tempBolusSize;
    let target_bg: number | undefined;

    for (let i=0; i < splitHistory.length; i++) {

        const currentItem = splitHistory[i];

        if (currentItem.duration! > 0) {

            let currentRate: number = profile_data.current_basal;
            if (!_.isEmpty(profile_data.basalprofile)) {
                currentRate = getCurrentBasalRate(profile_data.basalprofile,new Date(currentItem.timestamp!))!;
            }

            if (profile_data.min_bg !== undefined && profile_data.max_bg !== undefined) {
                target_bg = (profile_data.min_bg + profile_data.max_bg) / 2;
            }
            let sensitivityRatio: number | undefined;
            const profile = profile_data;
            const normalTarget = EXERCISE_NORMAL_TARGET; // evaluate high/low temptarget against 100, not scheduled basal (which might change)
            let halfBasalTarget: number;
            if ( profile.half_basal_exercise_target ) {
                halfBasalTarget = profile.half_basal_exercise_target;
            } else {
                halfBasalTarget = EXERCISE_HALF_BASAL_TARGET; // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
            }
            if ( profile.exercise_mode && profile.temptargetSet && target_bg! >= normalTarget + 5 ) {
                // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
                // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
                const c = halfBasalTarget - normalTarget;
                sensitivityRatio = c/(c+target_bg!-normalTarget);
            } else if (autosens_data !== undefined ) {
                sensitivityRatio = autosens_data.ratio;
            }
            if ( sensitivityRatio ) {
                currentRate = currentRate * sensitivityRatio;
            }

            const netBasalRate = currentItem.rate! - currentRate;
            if (netBasalRate < 0) { tempBolusSize = -0.05; }
            else { tempBolusSize = 0.05; }
            const netBasalAmount = Math.round(netBasalRate*currentItem.duration!*10/6)/100
            const tempBolusCount = Math.round(netBasalAmount / tempBolusSize);
            const tempBolusSpacing = currentItem.duration! / tempBolusCount;
            for (let j=0; j < tempBolusCount; j++) {
                const tempBolus: TempEvent = {} as TempEvent;
                tempBolus.insulin = tempBolusSize;
                tempBolus.date = currentItem.date + j * tempBolusSpacing*MS_PER_MINUTE;
                tempBolus.created_at = new Date(tempBolus.date);
                tempBoluses.push(tempBolus);
            }
        }
    }
    return tempBoluses;
}
