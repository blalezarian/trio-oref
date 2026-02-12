
import tz from 'moment-timezone';
import find_insulin from './history';
import calculate from './calculate';
import sum from './total';

import type { PumpHistoryEvent, Treatment, IOBContribution, InsulinCurve } from '../types/index';

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

    var treatmentsWithZeroTemp: IobIndexTreatment[];
    if (!treatments) {
        treatments = find_insulin(inputs);
        // calculate IOB based on continuous future zero temping as well
        treatmentsWithZeroTemp = find_insulin(inputs, 240);
    } else {
        treatmentsWithZeroTemp = [];
    }
    //console.error(treatments.length, treatmentsWithZeroTemp.length);
    //console.error(treatments[treatments.length-1], treatmentsWithZeroTemp[treatmentsWithZeroTemp.length-1])

    var opts: IobGenerateOpts = {
        treatments: treatments
    , profile: inputs.profile
    , calculate: calculate
    };
    if ( inputs.autosens ) {
        opts.autosens = inputs.autosens;
    }
    var optsWithZeroTemp: IobGenerateOpts = {
        treatments: treatmentsWithZeroTemp
    , profile: inputs.profile
    , calculate: calculate
    };

    var iobArray: IobIndexEntry[] = [];
    //console.error(inputs.clock);
    if (! /(Z|[+-][0-2][0-9]:?[034][05])+/.test(inputs.clock) ) {
        console.error("Warning: clock input " + inputs.clock + " is unzoned; please pass clock-zoned.json instead");
    }
    var clock = new Date(tz(inputs.clock));

    var lastBolusTime: number = new Date(0).getTime(); //clock.getTime());
    var lastTemp: IobIndexTreatment = { date: new Date(0).getTime() } as IobIndexTreatment;
    //console.error(treatments[treatments.length-1]);
    treatments.forEach(function(treatment: IobIndexTreatment) {
        if (treatment.insulin && treatment.started_at) {
            lastBolusTime = Math.max(lastBolusTime, treatment.started_at.getTime());
            //console.error(treatment.insulin,treatment.started_at,lastBolusTime);
        } else if (typeof(treatment.rate) === 'number' && treatment.duration ) {
            if ( treatment.date > lastTemp.date ) {
                lastTemp = treatment;
                lastTemp.duration = Math.round(lastTemp.duration!*100)/100;
            }

            //console.error(treatment.rate, treatment.duration, treatment.started_at,lastTemp.started_at)
        }
        //console.error(treatment.rate, treatment.duration, treatment.started_at,lastTemp.started_at)
        //if (treatment.insulin && treatment.started_at) { console.error(treatment.insulin,treatment.started_at,lastBolusTime); }
    });
    var iStop;
    if (currentIOBOnly) {
        // for COB calculation, we only need the zeroth element of iobArray
        iStop=1
    } else {
        // predict IOB out to 4h, regardless of DIA
        iStop=4*60;
    }
    var t: Date;
    for (var i=0; i<iStop; i+=5){
        t = new Date(clock.getTime() + i*60000);
        //console.error(t);
        var iob = sum(opts as Parameters<typeof sum>[0], t) as IobIndexEntry;
        var iobWithZeroTemp = sum(optsWithZeroTemp as Parameters<typeof sum>[0], t) as IobIndexEntry;
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
