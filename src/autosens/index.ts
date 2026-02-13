import { prepareAutosensData } from './prepare-data';
import { analyzeDeviations } from './deviation-loop';
import { padDeviations, analyzePercentiles, calculateAutosensRatio } from './calculate-ratio';
import type { AutosensInputs } from './prepare-data';
import type { AutosensResult } from './calculate-ratio';
import { DEFAULT_AUTOSENS_LOOKBACK } from '../shared/constants';

/** Maximum zero-deviation padding count (90m / 5m = 18) */
const MAX_ZERO_DEVIATION_PAD = 18;

/** Orchestrate autosens: prepare data, analyze deviations, compute ratio */
export function detectSensitivity(inputs: AutosensInputs): AutosensResult {
    const {
        treatments,
        meals,
        bucketed_data,
        lastSiteChange,
        iob_inputs,
        basalprofile,
        profile,
    } = prepareAutosensData(inputs);

    const { deviations, avgDeltas, bgis } = analyzeDeviations(
        bucketed_data,
        meals,
        iob_inputs,
        basalprofile,
        profile,
        treatments,
        inputs.temptargets,
        inputs.retrospective,
        inputs.deviations,
    );

    // when we have less than 8h worth of deviation data, add up to 90m of zero deviations
    // this dampens any large sensitivity changes detected based on too little data, without ignoring them completely
    console.error("");
    console.error("Using most recent", deviations.length, "deviations since", lastSiteChange);
    padDeviations(deviations, DEFAULT_AUTOSENS_LOOKBACK, MAX_ZERO_DEVIATION_PAD);
    const { pSensitive, pResistant } = analyzePercentiles(deviations, avgDeltas, bgis);
    return calculateAutosensRatio(
        deviations,
        pSensitive,
        pResistant,
        {
            sens: profile.sens as number,
            max_daily_basal: profile.max_daily_basal as number,
            autosens_min: profile.autosens_min as number,
            autosens_max: profile.autosens_max as number,
        },
    );
}
