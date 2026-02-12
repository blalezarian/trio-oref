import basal from '../profile/basal';
import get_iob from '../iob/index';
import find_insulin from '../iob/history';
import isf from '../profile/isf';
import type { GlucoseEntry, BucketedGlucose } from '../types/index';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    MS_PER_5_MIN,
    PRED_INTERVAL_MINUTES,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../constants';

interface CarbAbsorptionInputs {
  glucose_data: GlucoseEntry[] | undefined;
  iob_inputs: {
    profile: Record<string, unknown>;
    history: Array<Record<string, unknown>>;
    clock?: string | Date;
  };
  basalprofile: Array<Record<string, unknown>>;
  mealTime: number | string | Date;
  ciTime?: number | string | Date;
}

interface CarbAbsorptionResult {
  carbsAbsorbed: number;
  currentDeviation: number;
  maxDeviation: number;
  minDeviation: number;
  slopeFromMaxDeviation: number;
  slopeFromMinDeviation: number;
  allDeviations: number[];
}

/** Time window for CI-mode lookback (45 minutes in ms) */
const CI_LOOKBACK_MS = 45 * MS_PER_MINUTE;
/** Maximum interpolation gap cap (4 hours in minutes) */
const MAX_INTERPOLATION_GAP_MINUTES = 240;
/** Elapsed-minutes gap above which BG data is interpolated */
const BUCKETING_GAP_THRESHOLD_MIN = 8;

export function detectCarbAbsorption(inputs: CarbAbsorptionInputs): CarbAbsorptionResult {

    let profile: Record<string, unknown>;
    const glucose_data = inputs.glucose_data!.map((obj: GlucoseEntry) => {
        //Support the NS sgv field to avoid having to convert in a custom way
        obj.glucose = obj.glucose || obj.sgv;
        return obj;
    });
    const iob_inputs = inputs.iob_inputs;
    const basalprofile = inputs.basalprofile;
    /* TODO why does declaring profile break tests-command-behavior.tests.sh? */
    profile = inputs.iob_inputs.profile as Record<string, unknown>;
    const mealTime = new Date(inputs.mealTime as string | number);
    const ciTime = new Date(inputs.ciTime as string | number);

    //console.error(mealTime, ciTime);

    // get treatments from pumphistory once, not every time we get_iob()
    const treatments = find_insulin(inputs.iob_inputs as any);

    const avgDeltas: string[] = [];
    const bgis: string[] = [];
    const deviations: string[] = [];
    const deviationSum = 0;
    let carbsAbsorbed = 0;
    const bucketed_data: BucketedGlucose[] = [];
    bucketed_data[0] = glucose_data[0];
    let j=0;
    let foundPreMealBG = false;
    let lastbgi = 0;

    if (! glucose_data[0].glucose || glucose_data[0].glucose < MIN_VALID_GLUCOSE_MGDL) {
      lastbgi = -1;
    }

    let i: number;
    let bgTime: Date | undefined;
    let lastbgTime: Date | undefined;
    for (i=1; i < glucose_data.length; ++i) {
        if (glucose_data[i].display_time) {
            bgTime = new Date(glucose_data[i].display_time!.replace('T', ' '));
        } else if (glucose_data[i].dateString) {
            bgTime = new Date(glucose_data[i].dateString!);
        } else { console.error("Could not determine BG time"); }
        if (! glucose_data[i].glucose || glucose_data[i].glucose! < MIN_VALID_GLUCOSE_MGDL) {
//console.error("skipping:",glucose_data[i].glucose);
            continue;
        }
        // only consider BGs for 6h after a meal for calculating COB
        const hoursAfterMeal = (Number(bgTime)-Number(mealTime))/MS_PER_HOUR;
        if (hoursAfterMeal > (profile.maxMealAbsorptionTime as number) || foundPreMealBG) {
            continue;
        } else if (hoursAfterMeal < 0) {
//console.error("Found pre-meal BG:",glucose_data[i].glucose, bgTime, Math.round(hoursAfterMeal*100)/100);
            foundPreMealBG = true;
        }
//console.error(glucose_data[i].glucose, bgTime, Math.round(hoursAfterMeal*100)/100, bucketed_data[bucketed_data.length-1].display_time);
        // only consider last ~45m of data in CI mode
        // this allows us to calculate deviations for the last ~30m
        if (ciTime !== undefined) {
            const hoursAgo = (Number(ciTime)-Number(bgTime))/CI_LOOKBACK_MS;
            if (hoursAgo > 1 || hoursAgo < 0) {
                continue;
            }
        }
        if (bucketed_data[bucketed_data.length-1].display_time) {
            lastbgTime = new Date(bucketed_data[bucketed_data.length-1].display_time!.replace('T', ' '));
        } else if ((lastbgi >= 0) && glucose_data[lastbgi].display_time) {
            lastbgTime = new Date(glucose_data[lastbgi].display_time!.replace('T', ' '));
        } else if ((lastbgi >= 0) && glucose_data[lastbgi].dateString) {
            lastbgTime = new Date(glucose_data[lastbgi].dateString!);
        } else { console.error("Could not determine last BG time"); }
        let elapsed_minutes = (Number(bgTime) - Number(lastbgTime))/MS_PER_MINUTE;
    //console.error(bgTime, lastbgTime, elapsed_minutes);
        if(Math.abs(elapsed_minutes) > BUCKETING_GAP_THRESHOLD_MIN) {
            // interpolate missing data points
            let lastbg = glucose_data[lastbgi].glucose!;
            // cap interpolation at a maximum of 4h
            elapsed_minutes = Math.min(MAX_INTERPOLATION_GAP_MINUTES,Math.abs(elapsed_minutes));
            //console.error(elapsed_minutes);
            while(elapsed_minutes > PRED_INTERVAL_MINUTES) {
                const previousbgTime = new Date(lastbgTime!.getTime() - MS_PER_5_MIN);
                j++;
                bucketed_data[j] = {} as BucketedGlucose;
                bucketed_data[j].date = previousbgTime.getTime();
                const gapDelta = glucose_data[i].glucose! - lastbg;
                //console.error(gapDelta, lastbg, elapsed_minutes);
                const previousbg = lastbg + (PRED_INTERVAL_MINUTES/elapsed_minutes * gapDelta);
                bucketed_data[j].glucose = Math.round(previousbg);
                //console.error("Interpolated", bucketed_data[j]);

                elapsed_minutes = elapsed_minutes - PRED_INTERVAL_MINUTES;
                lastbg = previousbg;
                lastbgTime = new Date(previousbgTime);
            }

        } else if(Math.abs(elapsed_minutes) > BUCKETING_MERGE_THRESHOLD_MIN) {
            j++;
            bucketed_data[j]=glucose_data[i];
            bucketed_data[j].date = bgTime!.getTime();
        } else {
            bucketed_data[j].glucose = (bucketed_data[j].glucose! + glucose_data[i].glucose!)/2;
        }

        lastbgi = i;
        //console.error(bucketed_data[j].date)
    }
    let currentDeviation: number;
    let slopeFromMaxDeviation = 0;
    let slopeFromMinDeviation = 999;
    let maxDeviation = 0;
    let minDeviation = 999;
    const allDeviations: number[] = [];
    //console.error(bucketed_data);
    for (i=0; i < bucketed_data.length-3; ++i) {
        bgTime = new Date(bucketed_data[i].date!);

        const sens = isf.isfLookup((profile.isfProfile as { sensitivities: Array<{ offset: number; sensitivity: number }> }),bgTime);

        //console.error(bgTime , bucketed_data[i].glucose, bucketed_data[i].date);
        let bg: number;
        let avgDelta: number | string;
        let delta: number;
        if (bucketed_data[i].glucose !== undefined) {
            bg = bucketed_data[i].glucose!;
            if ( bg < MIN_VALID_GLUCOSE_MGDL || bucketed_data[i+3].glucose! < MIN_VALID_GLUCOSE_MGDL) {
                process.stderr.write("!");
                continue;
            }
            avgDelta = (bg - bucketed_data[i+3].glucose!)/3;
            delta = (bg - bucketed_data[i+1].glucose!);
        } else { console.error("Could not find glucose data"); }

        avgDelta = (avgDelta! as number).toFixed(2);
        iob_inputs.clock=bgTime;
        (iob_inputs.profile as Record<string, unknown>).current_basal = basal.basalLookup(basalprofile as any, bgTime);
        //console.log(JSON.stringify(iob_inputs.profile));
        //console.error("Before: ", new Date().getTime());
        const iob = get_iob(iob_inputs as any, true, treatments)[0];
        //console.error("After: ", new Date().getTime());
        //console.error(JSON.stringify(iob));

        let bgImpact: number | string = Math.round(( -iob.activity * sens * PRED_INTERVAL_MINUTES )*100)/100;
        bgImpact = bgImpact.toFixed(2);
        //console.error(delta);
        let deviation: number | string = delta! - (bgImpact as unknown as number);
        deviation = deviation.toFixed(2);
        //if (deviation < 0 && deviation > -2) { console.error("BG: "+bg+", avgDelta: "+avgDelta+", BGI: "+bgi+", deviation: "+deviation); }
        // calculate the deviation right now, for use in min_5m
        if (i===0) {
            currentDeviation = Math.round((Number(avgDelta)-(bgImpact as unknown as number))*1000)/1000;
            if (ciTime > bgTime) {
                //console.error("currentDeviation:",currentDeviation,avgDelta,bgi);
                allDeviations.push(Math.round(currentDeviation));
            }
            if (currentDeviation/2 > (profile.min_5m_carbimpact as number)) {
                //console.error("currentDeviation",currentDeviation,"/2 > min_5m_carbimpact",profile.min_5m_carbimpact);
            }
        } else if (ciTime > bgTime) {
            const avgDeviation = Math.round((Number(avgDelta)-(bgImpact as unknown as number))*1000)/1000;
            const deviationSlope = (avgDeviation-currentDeviation!)/(bgTime.getTime()-ciTime.getTime())*MS_PER_5_MIN;
            //console.error(avgDeviation,currentDeviation,bgTime,ciTime)
            if (avgDeviation > maxDeviation) {
                slopeFromMaxDeviation = Math.min(0, deviationSlope);
                maxDeviation = avgDeviation;
            }
            if (avgDeviation < minDeviation) {
                slopeFromMinDeviation = Math.max(0, deviationSlope);
                minDeviation = avgDeviation;
            }

            //console.error("Deviations:",avgDeviation, avgDelta,bgi,bgTime);
            allDeviations.push(Math.round(avgDeviation));
            //console.error(allDeviations);
        }

        // if bgTime is more recent than mealTime
        if(bgTime > mealTime) {
            // figure out how many carbs that represents
            // if currentDeviation is > 2 * min_5m_carbimpact, assume currentDeviation/2 worth of carbs were absorbed
            // but always assume at least profile.min_5m_carbimpact (3mg/dL/5m by default) absorption
            const carbImpact = Math.max(Number(deviation), currentDeviation!/2, profile.min_5m_carbimpact as number);
            const absorbed = carbImpact * (profile.carb_ratio as number) / sens;
            // and add that to the running total carbsAbsorbed
            //console.error("carbsAbsorbed:",carbsAbsorbed,"absorbed:",absorbed,"bgTime:",bgTime,"BG:",bucketed_data[i].glucose)
            carbsAbsorbed += absorbed;
        }
    }
    if(maxDeviation>0) {
        //console.error("currentDeviation:",currentDeviation,"maxDeviation:",maxDeviation,"slopeFromMaxDeviation:",slopeFromMaxDeviation);
    }

    return {
        "carbsAbsorbed": carbsAbsorbed
    ,   "currentDeviation": currentDeviation!
    ,   "maxDeviation": maxDeviation
    ,   "minDeviation": minDeviation
    ,   "slopeFromMaxDeviation": slopeFromMaxDeviation
    ,   "slopeFromMinDeviation": slopeFromMinDeviation
    ,   "allDeviations": allDeviations
    }
}
