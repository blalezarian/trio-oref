import type { AutotunePeakDeviation } from './types';
import { AUTOTUNE_IMPROVEMENT_THRESHOLD } from '../shared/constants';
import {
    INITIAL_MIN_DEVIATION,
    CURRENT_INDEX,
} from './constants';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Tune insulin peak time by comparing deviation metrics across candidate values */
export function tunePeakTime(
    peakDeviations: AutotunePeakDeviation[] | undefined,
    currentPeak: number | undefined,
): number | undefined {
    if (!peakDeviations || !peakDeviations[CURRENT_INDEX]) {
        return currentPeak;
    }

    const currentMeanDev = peakDeviations[CURRENT_INDEX].meanDeviation;
    const currentRMSDev = peakDeviations[CURRENT_INDEX].RMSDeviation;

    // Find which candidate indices have the lowest mean and RMS deviations
    let minMeanDev = INITIAL_MIN_DEVIATION;
    let minRMSDev = INITIAL_MIN_DEVIATION;
    let meanBest = CURRENT_INDEX;
    let RMSBest = CURRENT_INDEX;

    for (let candidateIdx = 0; candidateIdx < peakDeviations.length; candidateIdx++) {
        const candidate = peakDeviations[candidateIdx];
        if (candidate.meanDeviation < minMeanDev) {
            minMeanDev = Math.round(candidate.meanDeviation * 1000) / 1000;
            meanBest = candidateIdx;
        }
        if (candidate.RMSDeviation < minRMSDev) {
            minRMSDev = Math.round(candidate.RMSDeviation * 1000) / 1000;
            RMSBest = candidateIdx;
        }
    }

    console.error(`Best insulinPeakTime for meanDeviations: ${peakDeviations[meanBest].peak} minutes`);
    console.error(`Best insulinPeakTime for RMSDeviations: ${peakDeviations[RMSBest].peak} minutes`);

    // Adjust peak if both mean and RMS agree that a shorter or longer peak is better,
    // and the adjacent candidate's improvement exceeds the threshold
    let newPeak: number | undefined = currentPeak;

    if (meanBest < CURRENT_INDEX && RMSBest < CURRENT_INDEX) {
        // Both metrics favor a shorter peak — check the one-step-shorter candidate
        if (peakDeviations[CURRENT_INDEX - 1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            peakDeviations[CURRENT_INDEX - 1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newPeak = peakDeviations[CURRENT_INDEX - 1].peak;
        }
    } else if (meanBest > CURRENT_INDEX && RMSBest > CURRENT_INDEX) {
        // Both metrics favor a longer peak — check the one-step-longer candidate
        if (peakDeviations[CURRENT_INDEX + 1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            peakDeviations[CURRENT_INDEX + 1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newPeak = peakDeviations[CURRENT_INDEX + 1].peak;
        }
    }

    if (newPeak !== currentPeak) {
        console.error(`Adjusting insulinPeakTime from ${currentPeak} to ${newPeak} minutes`);
    } else {
        console.error(`Leaving insulinPeakTime unchanged at ${currentPeak}`);
    }

    return newPeak;
}
