import find_insulin from '../iob/extract-treatments';
import find_meals from '../meal/history';
import tz from 'moment-timezone';
import { normalizeGlucoseData } from '../utils/glucose-math';
import type { PumpHistoryEvent, GlucoseEntry, CarbTreatment } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import type { TempTarget } from '../profile/targets';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    HOURS_PER_DAY,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../constants';

// ---------------------------------------------------------------------------
// Input / output interfaces
// ---------------------------------------------------------------------------

export interface AutosensInputs {
    glucose_data: GlucoseEntry[];
    iob_inputs: {
        profile: IobProfile;
        history: PumpHistoryEvent[];
        clock: string | Date;
    };
    basalprofile: HistoryBasalProfileEntry[];
    carbs: PumpHistoryEvent[];
    temptargets?: TempTarget[];
    retrospective?: boolean;
    deviations?: number;
}

export interface PreparedAutosensData {
    treatments: IobTreatment[];
    meals: CarbTreatment[];
    bucketed_data: (GlucoseEntry & { mealCarbs?: number })[];
    lastSiteChange: Date;
    iob_inputs: AutosensInputs['iob_inputs'];
    basalprofile: HistoryBasalProfileEntry[];
    profile: IobProfile;
}

// ---------------------------------------------------------------------------
// Site change detection
// ---------------------------------------------------------------------------

/** Determine lookback window based on site change / rewind history */
export function determineSiteChangeTime(
    glucose_data: GlucoseEntry[],
    retrospective: boolean | undefined,
    history: PumpHistoryEvent[],
    rewindResetsAutosens: boolean | undefined
): Date {
    // use last 24h worth of data by default
    let lastSiteChange: Date;
    if (retrospective) {
        //console.error(glucose_data[0]);
        lastSiteChange = new Date(new Date(glucose_data[0].date!).getTime() - (HOURS_PER_DAY * MS_PER_HOUR));
    } else {
        lastSiteChange = new Date(new Date().getTime() - (HOURS_PER_DAY * MS_PER_HOUR));
    }
    if (rewindResetsAutosens === true) {
        // scan through pumphistory and set lastSiteChange to the time of the last pump rewind event
        // if not present, leave lastSiteChange unchanged at 24h ago.
        for (let h=1; h < history.length; ++h) {
            if ( ! history[h]._type || history[h]._type !== "Rewind" ) {
                //process.stderr.write("-");
                continue;
            }
            if ( history[h].timestamp ) {
                lastSiteChange = new Date( history[h].timestamp! );
                console.error("Setting lastSiteChange to",lastSiteChange,"using timestamp",history[h].timestamp);
                break;
            }
        }
    }
    return lastSiteChange;
}

// ---------------------------------------------------------------------------
// Data preparation
// ---------------------------------------------------------------------------

/** Prepare all data needed for autosens analysis */
export function prepareAutosensData(inputs: AutosensInputs): PreparedAutosensData {

    //console.error(inputs.glucose_data[0]);
    const glucose_data = normalizeGlucoseData(inputs.glucose_data);
    //console.error(glucose_data[0]);
    const iob_inputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    const profile = inputs.iob_inputs.profile;

    const lastSiteChange = determineSiteChangeTime(
        glucose_data,
        inputs.retrospective,
        inputs.iob_inputs.history,
        inputs.iob_inputs.profile.rewind_resets_autosens
    );

    // get treatments from pumphistory once, not every time we get_iob()
    const treatments = find_insulin(inputs.iob_inputs as IobInputs);

    const mealinputs = {
        history: inputs.iob_inputs.history
    , profile: profile
    , carbs: inputs.carbs
    , glucose: inputs.glucose_data
    //, prepped_glucose: prepped_glucose_data
    };
    const meals = find_meals(mealinputs);
    meals.sort((a: CarbTreatment, b: CarbTreatment) => {
        const aDate = new Date(tz(a.timestamp));
        const bDate = new Date(tz(b.timestamp));
        //console.error(aDate);
        return bDate.getTime() - aDate.getTime();
    });
    //console.error(meals);

    const bucketed_data: (GlucoseEntry & { mealCarbs?: number })[] = [];
    glucose_data.reverse();
    bucketed_data[0] = glucose_data[0];
    //console.error(bucketed_data[0]);
    let j=0;
    // go through the meal treatments and remove any that are older than the oldest glucose value
    //console.error(meals);
    // bgTime and lastbgTime declared here to preserve var-hoisted (function-scoped) semantics
    let bgTime: Date | undefined;
    let lastbgTime: Date | undefined;
    for (let i=1; i < glucose_data.length; ++i) {
        if (glucose_data[i].display_time) {
            bgTime = new Date(glucose_data[i].display_time!.replace('T', ' '));
        } else if (glucose_data[i].dateString) {
            bgTime = new Date(glucose_data[i].dateString!);
        } else if (glucose_data[i].xDrip_started_at) {
            continue;
        } else { console.error("Could not determine BG time"); }
        if (glucose_data[i-1].display_time) {
            lastbgTime = new Date(glucose_data[i-1].display_time!.replace('T', ' '));
        } else if (glucose_data[i-1].dateString) {
            lastbgTime = new Date(glucose_data[i-1].dateString!);
        } else if (bucketed_data[0].display_time) {
            lastbgTime = new Date(bucketed_data[0].display_time!.replace('T', ' '));
        } else if (glucose_data[i-1].xDrip_started_at) {
            continue;
        } else { console.error("Could not determine last BG time"); }
        if (glucose_data[i].glucose! < MIN_VALID_GLUCOSE_MGDL || glucose_data[i-1].glucose! < MIN_VALID_GLUCOSE_MGDL) {
//console.error("skipping:",glucose_data[i].glucose,glucose_data[i-1].glucose);
            continue;
        }
        // only consider BGs since lastSiteChange
        if (lastSiteChange) {
            const hoursSinceSiteChange = ((bgTime ? bgTime.getTime() : NaN) - lastSiteChange.getTime())/MS_PER_HOUR;
            if (hoursSinceSiteChange < 0) {
                //console.error(hoursSinceSiteChange, bgTime, lastSiteChange);
                continue;
            }
        }
        const elapsed_minutes = ((bgTime ? bgTime.getTime() : NaN) - (lastbgTime ? lastbgTime.getTime() : NaN))/MS_PER_MINUTE;
        if(Math.abs(elapsed_minutes) > BUCKETING_MERGE_THRESHOLD_MIN) {
            j++;
            bucketed_data[j]=glucose_data[i];
            bucketed_data[j].date = bgTime ? bgTime.getTime() : NaN;
            //console.error(elapsed_minutes, bucketed_data[j].glucose, glucose_data[i].glucose);
        } else {
            bucketed_data[j].glucose = (bucketed_data[j].glucose! + glucose_data[i].glucose!)/2;
            //console.error(bucketed_data[j].glucose, glucose_data[i].glucose);
        }
    }
    bucketed_data.shift();
    //console.error(bucketed_data[0]);
    // treatment, treatmentDate, treatmentTime, glucoseDatum, BGDate, BGTime declared here
    // to preserve var-hoisted (function-scoped) semantics across the two for-loops
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: GlucoseEntry & { mealCarbs?: number };
    let BGDate: Date;
    let BGTime: number;
    for (let i=meals.length-1; i>0; --i) {
        treatment = meals[i];
        //console.error(treatment);
        if (treatment) {
            treatmentDate = new Date(tz(treatment.timestamp));
            treatmentTime = treatmentDate.getTime();
            glucoseDatum = bucketed_data[0];
            //console.error(glucoseDatum);
            if (! glucoseDatum || ! glucoseDatum.date) {
              //console.error("No date found on: ",glucoseDatum);
              continue;
            }
            BGDate = new Date(glucoseDatum.date);
            BGTime = BGDate.getTime();
            if ( treatmentTime < BGTime ) {
                //console.error("Removing old meal: ",treatmentDate);
                meals.splice(i,1);
            }
        }
    }

    return {
        treatments,
        meals,
        bucketed_data,
        lastSiteChange,
        iob_inputs,
        basalprofile,
        profile,
    };
}
