import type { AutotuneDiaDeviation } from './types';
import {
    AUTOTUNE_IMPROVEMENT_THRESHOLD,
    MAX_DIA_HOURS,
} from '../shared/constants';
import {
    INITIAL_MIN_DEVIATION,
    CURRENT_INDEX,
} from './constants';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune DIA (insulin duration) by comparing deviation metrics across candidate values */
export function tuneDIA(
    diaDeviations: AutotuneDiaDeviation[] | undefined,
    currentDIA: number,
): number {
    if (!diaDeviations) {
        return currentDIA;
    }

    const currentMeanDev = diaDeviations[CURRENT_INDEX].meanDeviation;
    const currentRMSDev = diaDeviations[CURRENT_INDEX].RMSDeviation;

    // Find which candidate indices have the lowest mean and RMS deviations
    let minMeanDev = INITIAL_MIN_DEVIATION;
    let minRMSDev = INITIAL_MIN_DEVIATION;
    let meanBest = CURRENT_INDEX;
    let RMSBest = CURRENT_INDEX;

    for (let candidateIdx = 0; candidateIdx < diaDeviations.length; candidateIdx++) {
        const candidate = diaDeviations[candidateIdx];
        if (candidate.meanDeviation < minMeanDev) {
            minMeanDev = Math.round(candidate.meanDeviation * 1000) / 1000;
            meanBest = candidateIdx;
        }
        if (candidate.RMSDeviation < minRMSDev) {
            minRMSDev = Math.round(candidate.RMSDeviation * 1000) / 1000;
            RMSBest = candidateIdx;
        }
    }

    console.error(`Best insulinEndTime for meanDeviations: ${diaDeviations[meanBest].dia} hours`);
    console.error(`Best insulinEndTime for RMSDeviations: ${diaDeviations[RMSBest].dia} hours`);

    // Adjust DIA if both mean and RMS agree that a shorter or longer DIA is better,
    // and the adjacent candidate's improvement exceeds the threshold
    let newDIA = currentDIA;

    if (meanBest < CURRENT_INDEX && RMSBest < CURRENT_INDEX) {
        // Both metrics favor a shorter DIA — check the one-step-shorter candidate
        if (diaDeviations[CURRENT_INDEX - 1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            diaDeviations[CURRENT_INDEX - 1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newDIA = diaDeviations[CURRENT_INDEX - 1].dia;
        }
    } else if (meanBest > CURRENT_INDEX && RMSBest > CURRENT_INDEX) {
        // Both metrics favor a longer DIA — check the one-step-longer candidate
        if (diaDeviations[CURRENT_INDEX + 1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            diaDeviations[CURRENT_INDEX + 1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newDIA = diaDeviations[CURRENT_INDEX + 1].dia;
        }
    }

    if (newDIA > MAX_DIA_HOURS) {
        console.error("insulinEndTime maximum is 12h: not raising further");
        newDIA = MAX_DIA_HOURS;
    }

    if (newDIA !== currentDIA) {
        console.error(`Adjusting insulinEndTime from ${currentDIA} to ${newDIA} hours`);
    } else {
        console.error(`Leaving insulinEndTime unchanged at ${currentDIA} hours`);
    }

    return newDIA;
}
