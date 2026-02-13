import basal from '../profile/basal';
import get_iob from '../iob/index';
import isf from '../profile/isf';
import { calculateBGImpact, calculateDeviation } from '../utils/glucose-math';
import type { BucketedGlucose } from '../types/index';
import type { IobProfile, HistoryBasalProfileEntry, IobInputs, IobTreatment } from '../iob/types';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_5_MIN,
} from '../constants';

// ---------------------------------------------------------------------------
// Output interface
// ---------------------------------------------------------------------------

export interface CarbAbsorptionResult {
    carbsAbsorbed: number;
    currentDeviation: number;
    maxDeviation: number;
    minDeviation: number;
    slopeFromMaxDeviation: number;
    slopeFromMinDeviation: number;
    allDeviations: number[];
}

// ---------------------------------------------------------------------------
// Main analysis loop
// ---------------------------------------------------------------------------

/** Analyze glucose deviations and track carb absorption */
export function analyzeAbsorption(
    bucketed_data: BucketedGlucose[],
    iob_inputs: { profile: IobProfile; history: unknown[]; clock?: string | Date },
    basalprofile: HistoryBasalProfileEntry[],
    profile: IobProfile,
    treatments: IobTreatment[],
    mealTime: Date,
    ciTime: Date
): CarbAbsorptionResult {
    let carbsAbsorbed = 0;
    let currentDeviation: number;
    let slopeFromMaxDeviation = 0;
    let slopeFromMinDeviation = 999;
    let maxDeviation = 0;
    let minDeviation = 999;
    const allDeviations: number[] = [];
    let bgTime: Date | undefined;
    //console.error(bucketed_data);
    for (let i=0; i < bucketed_data.length-3; ++i) {
        bgTime = new Date(bucketed_data[i].date!);

        const sens = isf.isfLookup(profile.isfProfile!,bgTime);

        //console.error(bgTime , bucketed_data[i].glucose, bucketed_data[i].date);
        let bg: number;
        let avgDelta: number;
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

        avgDelta = Math.round(avgDelta! * 100) / 100;
        iob_inputs.clock=bgTime;
        iob_inputs.profile.current_basal = basal.basalLookup(basalprofile, bgTime)!;
        //console.log(JSON.stringify(iob_inputs.profile));
        //console.error("Before: ", new Date().getTime());
        const iob = get_iob(iob_inputs as IobInputs, true, treatments)[0];
        //console.error("After: ", new Date().getTime());
        //console.error(JSON.stringify(iob));

        const bgImpact = calculateBGImpact(iob.activity, sens);
        //console.error(delta);
        const deviation = calculateDeviation(delta!, bgImpact);
        //if (deviation < 0 && deviation > -2) { console.error("BG: "+bg+", avgDelta: "+avgDelta+", BGI: "+bgi+", deviation: "+deviation); }
        // calculate the deviation right now, for use in min_5m
        if (i===0) {
            currentDeviation = Math.round((avgDelta - bgImpact)*1000)/1000;
            if (ciTime > bgTime) {
                //console.error("currentDeviation:",currentDeviation,avgDelta,bgi);
                allDeviations.push(Math.round(currentDeviation));
            }
            if (currentDeviation/2 > profile.min_5m_carbimpact!) {
                //console.error("currentDeviation",currentDeviation,"/2 > min_5m_carbimpact",profile.min_5m_carbimpact);
            }
        } else if (ciTime > bgTime) {
            const avgDeviation = Math.round((avgDelta - bgImpact)*1000)/1000;
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
            const carbImpact = Math.max(deviation, currentDeviation!/2, profile.min_5m_carbimpact!);
            const absorbed = carbImpact * profile.carb_ratio! / sens;
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
