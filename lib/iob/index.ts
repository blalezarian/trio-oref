
import tz from 'moment-timezone';
import find_insulin from './history';
import calculate from './calculate';
import sum from './total';

import type { PumpHistoryEvent, Treatment, IOBContribution, InsulinCurve } from '../types/index';
import { PRED_INTERVAL_MINUTES, MS_PER_MINUTE } from '../constants';

/** Lookahead minutes for zero-temp IOB projection */
const ZERO_TEMP_LOOKAHEAD_MINUTES = 240;
/** IOB prediction horizon: 4 hours at 5-minute intervals */
const IOB_PREDICTION_HORIZON_MINUTES = 4 * 60;
/** Rounding scale for 2 decimal places */
const ROUND_SCALE_2DP = 100;

interface IobIndexBasalProfileEntry {
    i: number;
    start: string;
    rate: number;
    minutes: number;
}

interface IobIndexProfile {
    dia: number;
    curve?: InsulinCurve;
    basalprofile: IobIndexBasalProfileEntry[];
    current_basal: number;
    max_daily_basal?: number;
    min_bg?: number;
    max_bg?: number;
    exercise_mode?: boolean;
    temptargetSet?: boolean;
    half_basal_exercise_target?: number;
    suspend_zeros_iob?: boolean;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;
}

interface IobIndexInputs {
    clock: string;
    history: PumpHistoryEvent[];
    history24?: PumpHistoryEvent[];
    profile: IobIndexProfile;
    autosens?: { ratio: number };
}

interface IobIndexEntry {
    iob: number;
    activity: number;
    basaliob: number;
    bolusiob: number;
    netbasalinsulin: number;
    bolusinsulin: number;
    time: Date;
    iobWithZeroTemp?: IobIndexEntry;
    lastBolusTime?: number;
    lastTemp?: {
        date: number;
        rate?: number;
        duration?: number;
        started_at?: Date | string;
    };
}

interface IobIndexTreatment {
    insulin?: number;
    date: number;
    created_at?: Date;
    started_at?: Date;
    timestamp?: string;
    rate?: number;
    duration?: number;
}

interface IobGenerateOpts {
    treatments: IobIndexTreatment[];
    profile: IobIndexProfile;
    calculate: typeof calculate;
    autosens?: { ratio: number };
}

function generate (inputs: IobIndexInputs, currentIOBOnly?: boolean, treatments?: IobIndexTreatment[]): IobIndexEntry[] {

    let treatmentsWithZeroTemp: IobIndexTreatment[];
    if (!treatments) {
        treatments = find_insulin(inputs);
        // calculate IOB based on continuous future zero temping as well
        treatmentsWithZeroTemp = find_insulin(inputs, ZERO_TEMP_LOOKAHEAD_MINUTES);
    } else {
        treatmentsWithZeroTemp = [];
    }
    //console.error(treatments.length, treatmentsWithZeroTemp.length);
    //console.error(treatments[treatments.length-1], treatmentsWithZeroTemp[treatmentsWithZeroTemp.length-1])

    const opts: IobGenerateOpts = {
        treatments: treatments
    , profile: inputs.profile
    , calculate: calculate
    };
    if ( inputs.autosens ) {
        opts.autosens = inputs.autosens;
    }
    const optsWithZeroTemp: IobGenerateOpts = {
        treatments: treatmentsWithZeroTemp
    , profile: inputs.profile
    , calculate: calculate
    };

    const iobArray: IobIndexEntry[] = [];
    //console.error(inputs.clock);
    if (! /(Z|[+-][0-2][0-9]:?[034][05])+/.test(inputs.clock) ) {
        console.error("Warning: clock input " + inputs.clock + " is unzoned; please pass clock-zoned.json instead");
    }
    const clock = new Date(tz(inputs.clock));

    let lastBolusTime: number = new Date(0).getTime(); //clock.getTime());
    let lastTemp: IobIndexTreatment = { date: new Date(0).getTime() } as IobIndexTreatment;
    //console.error(treatments[treatments.length-1]);
    treatments.forEach((treatment: IobIndexTreatment) => {
        if (treatment.insulin && treatment.started_at) {
            lastBolusTime = Math.max(lastBolusTime, treatment.started_at.getTime());
            //console.error(treatment.insulin,treatment.started_at,lastBolusTime);
        } else if (typeof(treatment.rate) === 'number' && treatment.duration ) {
            if ( treatment.date > lastTemp.date ) {
                lastTemp = treatment;
                lastTemp.duration = Math.round(lastTemp.duration!*ROUND_SCALE_2DP)/ROUND_SCALE_2DP;
            }

            //console.error(treatment.rate, treatment.duration, treatment.started_at,lastTemp.started_at)
        }
        //console.error(treatment.rate, treatment.duration, treatment.started_at,lastTemp.started_at)
        //if (treatment.insulin && treatment.started_at) { console.error(treatment.insulin,treatment.started_at,lastBolusTime); }
    });
    let iStop;
    if (currentIOBOnly) {
        // for COB calculation, we only need the zeroth element of iobArray
        iStop=1
    } else {
        // predict IOB out to 4h, regardless of DIA
        iStop=IOB_PREDICTION_HORIZON_MINUTES;
    }
    let t: Date;
    for (let i=0; i<iStop; i+=PRED_INTERVAL_MINUTES){
        t = new Date(clock.getTime() + i*MS_PER_MINUTE);
        //console.error(t);
        const iob = sum(opts as Parameters<typeof sum>[0], t) as IobIndexEntry;
        const iobWithZeroTemp = sum(optsWithZeroTemp as Parameters<typeof sum>[0], t) as IobIndexEntry;
        //console.error(opts.treatments[opts.treatments.length-1], optsWithZeroTemp.treatments[optsWithZeroTemp.treatments.length-1])
        iobArray.push(iob);
        //console.error(iob.iob, iobWithZeroTemp.iob);
        //console.error(iobArray.length-1, iobArray[iobArray.length-1]);
        iobArray[iobArray.length-1].iobWithZeroTemp = iobWithZeroTemp;
    }
    //console.error(lastBolusTime);
    iobArray[0].lastBolusTime = lastBolusTime;
    iobArray[0].lastTemp = lastTemp;
    return iobArray;
}

export default generate;
