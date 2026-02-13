
import type {
    AutotuneInputs,
    AutotunePreviousProfile,
    AutotunePumpProfile,
} from './types';
import {
    ULTRA_RAPID_PEAK,
    RAPID_ACTING_PEAK,
} from '../shared/constants';
import { tuneDIA } from './tune-dia';
import { tunePeakTime } from './tune-peak';
import { calculateTotalCarbRatio } from './calculate-total-carb-ratio';
import { tuneBasalProfile } from './tune-basal-profile';
import { tuneCSF } from './tune-csf';
import { tuneCarbRatio } from './tune-carb-ratio';
import { tuneISF } from './tune-isf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PumpBaselines {
    pumpISF: number | undefined;
    pumpCarbRatio: number | undefined;
    pumpCSF: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve insulin peak time: custom value if set, otherwise curve-based default */
export function resolvePeakTime(
    profile: AutotunePreviousProfile,
): number | undefined {
    if (profile.useCustomPeakTime) {
        return profile.insulinPeakTime;
    }
    return profile.curve === 'ultra-rapid' ? ULTRA_RAPID_PEAK : RAPID_ACTING_PEAK;
}

/** Extract pump baseline ISF, carb ratio, and CSF from pump profile */
export function extractPumpBaselines(
    pumpProfile: AutotunePumpProfile,
): PumpBaselines {
    const isfProfile = pumpProfile.isfProfile;
    if (!isfProfile?.sensitivities[0]) {
        return { pumpISF: undefined, pumpCarbRatio: undefined, pumpCSF: undefined };
    }
    const pumpISF = isfProfile.sensitivities[0].sensitivity;
    const pumpCarbRatio = pumpProfile.carb_ratio;
    const pumpCSF = pumpISF / (pumpCarbRatio as number);
    return { pumpISF, pumpCarbRatio, pumpCSF };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function autotuneProfile(
    inputs: AutotuneInputs,
): AutotunePreviousProfile | undefined {
    const { previousAutotune, pumpProfile, preppedGlucose } = inputs;

    // --- Resolve starting values from previous autotune run ---
    const isfProfile = previousAutotune.isfProfile;
    let ISF = isfProfile.sensitivities[0].sensitivity;
    let carbRatio = previousAutotune.carb_ratio;
    let CSF = ISF / carbRatio;
    const DIA = previousAutotune.dia;
    const peak = resolvePeakTime(previousAutotune);

    // --- Extract pump baseline values ---
    const { pumpISF, pumpCarbRatio, pumpCSF } = extractPumpBaselines(pumpProfile);
    if (!carbRatio) { carbRatio = pumpCarbRatio as number; }
    if (!CSF) { CSF = pumpCSF as number; }
    if (!ISF) { ISF = pumpISF as number; }

    // --- Destructure prepped glucose data ---
    const {
        CSFGlucoseData,
        ISFGlucoseData,
        basalGlucoseData,
        CRData,
        diaDeviations,
        peakDeviations,
    } = preppedGlucose;

    // --- Tune DIA and peak ---
    const newDIA = tuneDIA(diaDeviations, DIA);
    const newPeak = tunePeakTime(peakDeviations, peak);

    // --- Tune basal profile ---
    const basalResult = tuneBasalProfile(
        previousAutotune.basalprofile,
        pumpProfile.basalprofile,
        basalGlucoseData,
        ISF,
        pumpProfile,
    );
    if (!basalResult) { return undefined; }
    const basalProfile = basalResult.basalProfile;
    const bounds = basalResult.bounds;

    // --- Calculate total CR ---
    const { totalCR } = calculateTotalCarbRatio(CRData, ISF);

    // --- Tune CSF ---
    const newCSF = tuneCSF(
        CSFGlucoseData,
        CSF,
        previousAutotune.min_5m_carbimpact,
        pumpCSF,
        bounds,
    );
    if (newCSF) { CSF = newCSF; }

    // --- Tune CR ---
    const newCR = tuneCarbRatio(totalCR, carbRatio, pumpCarbRatio, bounds);
    if (newCR) { carbRatio = newCR; }

    // --- Tune ISF ---
    const isfResult = tuneISF(
        ISFGlucoseData,
        ISF,
        pumpISF,
        bounds,
        pumpProfile.autotune_isf_adjustmentFraction,
    );
    console.error(
        "p50deviation:", isfResult.p50deviation,
        "p50BGI", isfResult.p50BGI,
        "p50ratios:", isfResult.p50ratios,
        "Old ISF:", ISF,
        "fullNewISF:", isfResult.fullNewISF,
        "adjustedISF:", isfResult.adjustedISF,
        "newISF:", isfResult.newISF,
        "newDIA:", newDIA,
        "newPeak:", newPeak,
    );
    if (isfResult.newISF) { ISF = isfResult.newISF; }

    // --- Assemble output ---
    // Mutates previousAutotune directly, matching original behavior
    const autotuneOutput = previousAutotune;
    autotuneOutput.basalprofile = basalProfile;
    isfProfile.sensitivities[0].sensitivity = ISF;
    autotuneOutput.isfProfile = isfProfile;
    autotuneOutput.sens = ISF;
    autotuneOutput.csf = CSF;
    carbRatio = Math.round(carbRatio * 1000) / 1000;
    autotuneOutput.carb_ratio = carbRatio;
    autotuneOutput.dia = newDIA;
    autotuneOutput.insulinPeakTime = newPeak;
    if (diaDeviations || peakDeviations) {
        autotuneOutput.useCustomPeakTime = true;
    }

    return autotuneOutput;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default autotuneProfile;
