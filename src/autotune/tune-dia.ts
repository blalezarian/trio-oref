
import type { AutotuneDiaDeviation } from './types';
import {
    AUTOTUNE_IMPROVEMENT_THRESHOLD,
    MAX_DIA_HOURS,
} from '../shared/constants';

export function tuneDIA(
    diaDeviations: AutotuneDiaDeviation[] | undefined,
    currentDIA: number,
): number {
    if (!diaDeviations) {
        return currentDIA;
    }

    const currentMeanDev = diaDeviations[2].meanDeviation;
    const currentRMSDev = diaDeviations[2].RMSDeviation;

    let minMeanDev = 1000000;
    let minRMSDev = 1000000;
    let meanBest = 2;
    let RMSBest = 2;

    for (let i = 0; i < diaDeviations.length; i++) {
        if (diaDeviations[i].meanDeviation < minMeanDev) {
            minMeanDev = Math.round(diaDeviations[i].meanDeviation * 1000) / 1000;
            meanBest = i;
        }
        if (diaDeviations[i].RMSDeviation < minRMSDev) {
            minRMSDev = Math.round(diaDeviations[i].RMSDeviation * 1000) / 1000;
            RMSBest = i;
        }
    }

    console.error("Best insulinEndTime for meanDeviations:", diaDeviations[meanBest].dia, "hours");
    console.error("Best insulinEndTime for RMSDeviations:", diaDeviations[RMSBest].dia, "hours");

    let newDIA = currentDIA;

    if (meanBest < 2 && RMSBest < 2) {
        if (diaDeviations[1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            diaDeviations[1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newDIA = diaDeviations[1].dia;
        }
    } else if (meanBest > 2 && RMSBest > 2) {
        if (diaDeviations[3].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            diaDeviations[3].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newDIA = diaDeviations[3].dia;
        }
    }

    if (newDIA > MAX_DIA_HOURS) {
        console.error("insulinEndTime maximum is 12h: not raising further");
        newDIA = MAX_DIA_HOURS;
    }

    if (newDIA !== currentDIA) {
        console.error("Adjusting insulinEndTime from", currentDIA, "to", newDIA, "hours");
    } else {
        console.error("Leaving insulinEndTime unchanged at", currentDIA, "hours");
    }

    return newDIA;
}
