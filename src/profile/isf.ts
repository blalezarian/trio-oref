
import _ from 'lodash';
import { MINUTES_PER_DAY } from '../constants';

/** Error sentinel returned when ISF schedule has invalid first offset */
const ISF_LOOKUP_ERROR = -1;

interface ISFScheduleEntry {
  offset: number;
  sensitivity: number;
  endOffset?: number;
}

interface ISFData {
  sensitivities: ISFScheduleEntry[];
}

let lastResult: ISFScheduleEntry | null = null;

function isfLookup(isf_data: ISFData, timestamp?: Date): number {

    let nowDate = timestamp;

    if (timestamp === undefined) {
        nowDate = new Date();
    }

    const nowMinutes = nowDate!.getHours() * 60 + nowDate!.getMinutes();

    if (lastResult && nowMinutes >= lastResult.offset && nowMinutes < lastResult.endOffset!) {
        return lastResult.sensitivity;
    }

    const sorted = _.sortBy(isf_data.sensitivities, (o: ISFScheduleEntry) => { return o.offset; });

    let isfSchedule = sorted[sorted.length - 1];

    if (sorted[0].offset !== 0) {
        return ISF_LOOKUP_ERROR;
    }

    let endMinutes = MINUTES_PER_DAY;

    for (let i = 0; i < sorted.length - 1; i++) {
        const currentISF = sorted[i];
        const nextISF = sorted[i+1];
        if (nowMinutes >= currentISF.offset && nowMinutes < nextISF.offset) {
            endMinutes = nextISF.offset;
            isfSchedule = sorted[i];
            break;
        }
    }

    lastResult = isfSchedule;
    lastResult!.endOffset = endMinutes;

    return isfSchedule.sensitivity;
}

interface ISFLookupFn {
  (isf_data: ISFData, timestamp?: Date): number;
  isfLookup: (isf_data: ISFData, timestamp?: Date) => number;
}

(isfLookup as ISFLookupFn).isfLookup = isfLookup;
export default isfLookup as ISFLookupFn;
