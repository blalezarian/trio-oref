import { calcTempTreatments } from './extract-treatments';
import { iobCalc } from './calculate-single-iob';
import { iobTotal } from './sum-iob';
import { findLastBolusAndTemp } from './find-last-bolus-and-temp';

import type {
    IobInputs,
    IobTreatment,
    IobIndexEntry,
    IobGenerateOpts,
} from './types';
import { PRED_INTERVAL_MINUTES, MS_PER_MINUTE } from '../constants';

/** Lookahead minutes for zero-temp IOB projection */
const ZERO_TEMP_LOOKAHEAD_MINUTES = 240;
/** IOB prediction horizon: 4 hours at 5-minute intervals */
const IOB_PREDICTION_HORIZON_MINUTES = 4 * 60;

export function generate (
    inputs: IobInputs,
    currentIOBOnly?: boolean,
    treatments?: IobTreatment[],
): IobIndexEntry[] {

    let treatmentsWithZeroTemp: IobTreatment[];
    if (!treatments) {
        treatments = calcTempTreatments(inputs);
        // calculate IOB based on continuous future zero temping as well
        treatmentsWithZeroTemp = calcTempTreatments(inputs, ZERO_TEMP_LOOKAHEAD_MINUTES);
    } else {
        treatmentsWithZeroTemp = [];
    }

    const opts: IobGenerateOpts = {
        treatments: treatments
    , profile: inputs.profile
    , calculate: iobCalc
    };
    if ( inputs.autosens ) {
        opts.autosens = inputs.autosens;
    }
    const optsWithZeroTemp: IobGenerateOpts = {
        treatments: treatmentsWithZeroTemp
    , profile: inputs.profile
    , calculate: iobCalc
    };

    const iobArray: IobIndexEntry[] = [];
    if (! /(Z|[+-][0-2][0-9]:?[034][05])+/.test(inputs.clock) ) {
        console.error(`Warning: clock input ${inputs.clock} is unzoned; please pass clock-zoned.json instead`);
    }
    const clock = new Date(inputs.clock);

    const { lastBolusTime, lastTemp } = findLastBolusAndTemp(treatments);
    const iStop = currentIOBOnly ? 1 : IOB_PREDICTION_HORIZON_MINUTES;
    for (let i=0; i<iStop; i+=PRED_INTERVAL_MINUTES){
        const t = new Date(clock.getTime() + i*MS_PER_MINUTE);
        const iob = iobTotal(opts as Parameters<typeof iobTotal>[0], t) as IobIndexEntry;
        const iobWithZeroTemp = iobTotal(optsWithZeroTemp as Parameters<typeof iobTotal>[0], t) as IobIndexEntry;
        iobArray.push(iob);
        iobArray[iobArray.length-1].iobWithZeroTemp = iobWithZeroTemp;
    }
    iobArray[0].lastBolusTime = lastBolusTime;
    iobArray[0].lastTemp = lastTemp;
    return iobArray;
}
