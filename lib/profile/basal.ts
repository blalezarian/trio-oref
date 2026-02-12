
import _ from 'lodash';

/** Rounding scale for basal rate precision (3 decimal places) */
const BASAL_ROUND_SCALE = 1000;

interface BasalScheduleEntry {
  i?: number;
  minutes?: number;
  rate: number;
}

interface BasalInputs {
  basals: BasalScheduleEntry[];
  settings: { maxBasal: number };
}

/* Return basal rate(U / hr) at the provided timeOfDay */
function basalLookup (schedules: BasalScheduleEntry[], now?: Date): number | undefined {

    var nowDate = now;

    if (typeof(now) === 'undefined') {
      nowDate = new Date();
    }

    var basalprofile_data = _.sortBy(schedules, function(o: BasalScheduleEntry) { return o.i; });
    var basalRate = basalprofile_data[basalprofile_data.length-1].rate
    if (basalRate === 0) {
        console.error("ERROR: bad basal schedule",schedules);
        return;
    }
    var nowMinutes = nowDate!.getHours() * 60 + nowDate!.getMinutes();

    for (var i = 0; i < basalprofile_data.length - 1; i++) {
        if ((nowMinutes >= basalprofile_data[i].minutes!) && (nowMinutes < basalprofile_data[i + 1].minutes!)) {
            basalRate = basalprofile_data[i].rate;
            break;
        }
    }
    return Math.round(basalRate*BASAL_ROUND_SCALE)/BASAL_ROUND_SCALE;
}


function maxDailyBasal (inputs: BasalInputs): number {
    var maxRate = _.maxBy(inputs.basals,function(o: BasalScheduleEntry) { return Number(o.rate); });
    return (Number(maxRate!.rate) *BASAL_ROUND_SCALE)/BASAL_ROUND_SCALE;
}

/*Return maximum daily basal rate(U / hr) from profile.basals */

function maxBasalLookup (inputs: BasalInputs): number {
    return inputs.settings.maxBasal;
}


export { maxDailyBasal, maxBasalLookup, basalLookup };
export default { maxDailyBasal, maxBasalLookup, basalLookup };
