import { prepareAutosensData } from './prepareData';
import { analyzeDeviations } from './deviationLoop';
import { padDeviations, analyzePercentiles, calculateAutosensRatio } from './calculateRatio';
import type { AutosensInputs } from './prepareData';
import type { AutosensResult } from './calculateRatio';
import { DEFAULT_AUTOSENS_LOOKBACK } from '../shared/constants';

/** Maximum zero-deviation padding count (90m / 5m = 18) */
const MAX_ZERO_DEVIATION_PAD = 18;

/** Orchestrate autosens: prepare data, analyze deviations, compute ratio */
export function detectSensitivity(inputs: AutosensInputs): AutosensResult {
    const {
        treatments,
        meals,
        bucketed_data: bucketedData,
        lastSiteChange,
        iob_inputs: iobInputs,
        basalprofile,
        profile,
    } = prepareAutosensData(inputs);

    const { deviations, avgDeltas, bgis } = analyzeDeviations(
        bucketedData,
        meals,
        iobInputs,
        basalprofile,
        profile,
        treatments,
        inputs.temptargets,
        inputs.retrospective,
        inputs.deviations,
    );

    // when we have less than 8h worth of deviation data, add up to 90m of zero deviations
    // this dampens any large sensitivity changes detected based on too little data, without ignoring them completely
    console.log("");
    console.log(`Using most recent ${deviations.length} deviations since ${lastSiteChange}`);
    padDeviations(deviations, DEFAULT_AUTOSENS_LOOKBACK, MAX_ZERO_DEVIATION_PAD);
    const { pSensitive, pResistant } = analyzePercentiles(deviations, avgDeltas, bgis);
    return calculateAutosensRatio(
        deviations,
        pSensitive,
        pResistant,
        {
            sens: Number(profile.sens),
            max_daily_basal: Number(profile.max_daily_basal),
            autosens_min: Number(profile.autosens_min),
            autosens_max: Number(profile.autosens_max),
        },
    );
}
