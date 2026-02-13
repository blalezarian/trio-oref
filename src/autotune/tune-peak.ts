
import type { AutotunePeakDeviation } from './types';
import { AUTOTUNE_IMPROVEMENT_THRESHOLD } from '../constants';

export function tunePeakTime(
    peakDeviations: AutotunePeakDeviation[] | undefined,
    currentPeak: number | undefined,
): number | undefined {
    if (!peakDeviations || !peakDeviations[2]) {
        return currentPeak;
    }

    const currentMeanDev = peakDeviations[2].meanDeviation;
    const currentRMSDev = peakDeviations[2].RMSDeviation;

    let minMeanDev = 1000000;
    let minRMSDev = 1000000;
    let meanBest = 2;
    let RMSBest = 2;

    for (let i = 0; i < peakDeviations.length; i++) {
        if (peakDeviations[i].meanDeviation < minMeanDev) {
            minMeanDev = Math.round(peakDeviations[i].meanDeviation * 1000) / 1000;
            meanBest = i;
        }
        if (peakDeviations[i].RMSDeviation < minRMSDev) {
            minRMSDev = Math.round(peakDeviations[i].RMSDeviation * 1000) / 1000;
            RMSBest = i;
        }
    }

    console.error("Best insulinPeakTime for meanDeviations:", peakDeviations[meanBest].peak, "minutes");
    console.error("Best insulinPeakTime for RMSDeviations:", peakDeviations[RMSBest].peak, "minutes");

    let newPeak: number | undefined = currentPeak;

    if (meanBest < 2 && RMSBest < 2) {
        if (peakDeviations[1].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            peakDeviations[1].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newPeak = peakDeviations[1].peak;
        }
    } else if (meanBest > 2 && RMSBest > 2) {
        if (peakDeviations[3].meanDeviation < currentMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD &&
            peakDeviations[3].RMSDeviation < currentRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD) {
            newPeak = peakDeviations[3].peak;
        }
    }

    if (newPeak !== currentPeak) {
        console.error("Adjusting insulinPeakTime from", currentPeak, "to", newPeak, "minutes");
    } else {
        console.error("Leaving insulinPeakTime unchanged at", currentPeak);
    }

    return newPeak;
}
