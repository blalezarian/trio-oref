
import _ from 'lodash';

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
    return Math.round(basalRate*1000)/1000;
}


function maxDailyBasal (inputs: BasalInputs): number {
    var maxRate = _.maxBy(inputs.basals,function(o: BasalScheduleEntry) { return Number(o.rate); });
    return (Number(maxRate!.rate) *1000)/1000;
}

/*Return maximum daily basal rate(U / hr) from profile.basals */

function maxBasalLookup (inputs: BasalInputs): number {
    return inputs.settings.maxBasal;
}


export { maxDailyBasal, maxBasalLookup, basalLookup };
export default { maxDailyBasal, maxBasalLookup, basalLookup };
