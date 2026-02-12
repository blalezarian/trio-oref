
import _ from 'lodash';

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

    isf_data = _.sortBy(isf_data.sensitivities, function(o: ISFScheduleEntry) { return o.offset; }) as any;

    var isfSchedule = (isf_data as any)[(isf_data as any).length - 1];

    if ((isf_data as any)[0].offset !== 0) {
        return -1;
    }

    var endMinutes = 1440;

    for (var i = 0; i < (isf_data as any).length - 1; i++) {
        var currentISF = (isf_data as any)[i];
        var nextISF = (isf_data as any)[i+1];
        if (nowMinutes >= currentISF.offset && nowMinutes < nextISF.offset) {
            endMinutes = nextISF.offset;
            isfSchedule = (isf_data as any)[i];
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
