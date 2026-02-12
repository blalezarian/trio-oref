
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

var lastResult: ISFScheduleEntry | null = null;

function isfLookup(isf_data: ISFData, timestamp?: Date): number {

    var nowDate = timestamp;

    if (typeof(timestamp) === 'undefined') {
        nowDate = new Date();
    }

    var nowMinutes = nowDate!.getHours() * 60 + nowDate!.getMinutes();

    if (lastResult && nowMinutes >= lastResult.offset && nowMinutes < lastResult.endOffset!) {
        return lastResult.sensitivity;
    }

    var sorted = _.sortBy(isf_data.sensitivities, function(o: ISFScheduleEntry) { return o.offset; });

    var isfSchedule = sorted[sorted.length - 1];

    if (sorted[0].offset !== 0) {
        return ISF_LOOKUP_ERROR;
    }

    var endMinutes = MINUTES_PER_DAY;

    for (var i = 0; i < sorted.length - 1; i++) {
        var currentISF = sorted[i];
        var nextISF = sorted[i+1];
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
