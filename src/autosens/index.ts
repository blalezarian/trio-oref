import basal from '../profile/basal';
import get_iob from '../iob/index';
import isf from '../profile/isf';
import tz from 'moment-timezone';
import { calculateBGImpact, calculateDeviation } from '../utils/glucose-math';
import { prepareAutosensData } from './prepare-data';
import { padDeviations, analyzePercentiles, calculateAutosensRatio } from './calculate-ratio';
import type { AutosensInputs } from './prepare-data';
import type { AutosensResult } from './calculate-ratio';
import type { GlucoseEntry, CarbTreatment } from '../types/index';
import type { IobInputs } from '../iob/types';
import type { TempTarget } from '../profile/targets';
import {
    MS_PER_MINUTE,
    MIN_BG_TARGET,
    EXERCISE_NORMAL_TARGET,
    DEFAULT_AUTOSENS_LOOKBACK,
    AUTOSENS_MIN_VALID_BG,
} from '../constants';

/** Meal-start counter threshold: 9 intervals = ~45 minutes of exclusion */
const MEAL_EXCLUSION_COUNTER = 9;
/** Meal-start counter indicating >5h of absorption (60 intervals * 5m = 300m) */
const MEAL_ABSORPTION_LONG_COUNTER = 60;
/** Temp-target deviation divisor: (tempTarget - 100) / this */
const TEMP_TARGET_DEVIATION_DIVISOR = 20;
/** Maximum zero-deviation padding count (90m / 5m = 18) */
const MAX_ZERO_DEVIATION_PAD = 18;

export function detectSensitivity(inputs: AutosensInputs): AutosensResult {

    const {
        treatments,
        meals,
        bucketed_data,
        lastSiteChange,
        iob_inputs,
        basalprofile,
        profile,
    } = prepareAutosensData(inputs);

    const avgDeltas: number[] = [];
    const bgis: number[] = [];
    const deviations: number[] = [];
    let deviationSum = 0;
    // treatment, treatmentDate, treatmentTime, glucoseDatum, BGDate, BGTime declared here
    // to preserve var-hoisted (function-scoped) semantics across the for-loop
    let treatment: CarbTreatment;
    let treatmentDate: Date;
    let treatmentTime: number;
    let glucoseDatum: GlucoseEntry & { mealCarbs?: number };
    let BGDate: Date;
    let BGTime: number;
    let bgTime: Date | undefined;
    let absorbing = 0;
    let uam = 0; // unannounced meal
    let mealCOB = 0;
    let mealCarbs = 0;
    let mealStartCounter = 999;
    let type="";
    // displayCOB declared here to preserve var-hoisted (function-scoped) semantics
    let displayCOB: number;
    // last_bg, old_bg declared here to preserve var-hoisted (function-scoped) semantics
    let last_bg: number;
    let old_bg: number;
    //console.error(bucketed_data);
    for (let i=3; i < bucketed_data.length; ++i) {
        bgTime = new Date(bucketed_data[i].date!);

        const sens = isf.isfLookup(profile.isfProfile as Parameters<typeof isf.isfLookup>[0],bgTime);

        //console.error(bgTime , bucketed_data[i].glucose);
        let bg: number;
        let avgDelta: number;
        let delta: number;
        if (bucketed_data[i].glucose !== undefined) {
            bg = bucketed_data[i].glucose!;
            last_bg = bucketed_data[i-1].glucose!;
            old_bg = bucketed_data[i-3].glucose!;
            if ( isNaN(bg) || !bg || bg < AUTOSENS_MIN_VALID_BG || isNaN(old_bg) || !old_bg || old_bg < AUTOSENS_MIN_VALID_BG || isNaN(last_bg) || !last_bg || last_bg < AUTOSENS_MIN_VALID_BG) {
                process.stderr.write("!");
                continue;
            }
            avgDelta = (bg - old_bg)/3;
            delta = (bg - last_bg);
        } else {
            console.error("Could not find glucose data");
            continue;
        }

        avgDelta = parseFloat(avgDelta.toFixed(2));
        iob_inputs.clock=bgTime;
        iob_inputs.profile.current_basal = basal.basalLookup(basalprofile, bgTime)!;
        // make sure autosens doesn't use temptarget-adjusted insulin calculations
        iob_inputs.profile.temptargetSet = false;
        //console.log(JSON.stringify(iob_inputs.profile));
        //console.error("Before: ", new Date().getTime());
        const iob = get_iob(iob_inputs as IobInputs, true, treatments)[0];
        //console.error("After: ", new Date().getTime());
        //console.log(JSON.stringify(iob));

        const bgImpact = calculateBGImpact(iob.activity, sens);
        //console.error(delta);
        let deviation!: number;
        if (isNaN(delta)) {
            console.error("Bad delta: ",delta, bg, last_bg, old_bg);
        } else {
            deviation = calculateDeviation(delta, bgImpact, bg, MIN_BG_TARGET);
        }

        glucoseDatum = bucketed_data[i];
        //console.error(glucoseDatum);
        BGDate = new Date(glucoseDatum.date!);
        BGTime = BGDate.getTime();
        // As we're processing each data point, go through the treatment.carbs and see if any of them are older than
        // the current BG data point.  If so, add those carbs to COB.
        treatment = meals[meals.length-1];
        if (treatment) {
            treatmentDate = new Date(tz(treatment.timestamp));
            treatmentTime = treatmentDate.getTime();
            if ( treatmentTime < BGTime ) {
                if (treatment.carbs! >= 1) {
            //console.error(treatmentDate, treatmentTime, BGTime, BGTime-treatmentTime);
                    mealCOB += treatment.carbs!;
                    mealCarbs += treatment.carbs!;
                    displayCOB = Math.round(mealCOB);
                    //console.error(displayCOB, mealCOB, treatment.carbs);
                    process.stderr.write(`${displayCOB}g`);
                }
                meals.pop();
            }
        }

        // calculate carb absorption for that 5m interval using the deviation.
        if ( mealCOB > 0 ) {
            //var profile = profileData;
            const carbImpact = Math.max(deviation, profile.min_5m_carbimpact as number);
            const absorbed = carbImpact * (profile.carb_ratio as number) / sens;
            if (absorbed) {
                mealCOB = Math.max(0, mealCOB-absorbed);
            } else {
                console.error(absorbed, carbImpact, profile.carb_ratio, sens, deviation, profile.min_5m_carbimpact);
            }
        }

        // If mealCOB is zero but all deviations since hitting COB=0 are positive, exclude from autosens
        //console.error(mealCOB, absorbing, mealCarbs);
        if (mealCOB > 0 || absorbing || mealCarbs > 0) {
            if (deviation > 0 ) {
                absorbing = 1;
            } else {
                absorbing = 0;
            }
            // stop excluding positive deviations as soon as mealCOB=0 if meal has been absorbing for >5h
            if ( mealStartCounter > MEAL_ABSORPTION_LONG_COUNTER && mealCOB < 0.5 ) {
                displayCOB = Math.round(mealCOB);
                process.stderr.write(`${displayCOB}g`);
                absorbing = 0;
            }
            if ( ! absorbing && mealCOB < 0.5 ) {
                mealCarbs = 0;
            }
            // check previous "type" value, and if it wasn't csf, set a mealAbsorption start flag
            //console.error(type);
            if ( type !== "csf" ) {
                process.stderr.write("(");
                mealStartCounter = 0;
                //glucoseDatum.mealAbsorption = "start";
                //console.error(glucoseDatum.mealAbsorption,"carb absorption");
            }
            mealStartCounter++;
            type="csf";
            glucoseDatum.mealCarbs = mealCarbs;
            //if (i == 0) { glucoseDatum.mealAbsorption = "end"; }
            //CSFGlucoseData.push(glucoseDatum);
        } else {
          // check previous "type" value, and if it was csf, set a mealAbsorption end flag
          if ( type === "csf" ) {
            process.stderr.write(")");
            //CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption = "end";
            //console.error(CSFGlucoseData[CSFGlucoseData.length-1].mealAbsorption,"carb absorption");
          }

          const currentBasal = iob_inputs.profile.current_basal as number;
          // always exclude the first 45m after each carb entry using mealStartCounter
          //if (iob.iob > currentBasal || uam ) {
          if ((!inputs.retrospective && iob.iob > 2 * currentBasal) || uam || mealStartCounter < MEAL_EXCLUSION_COUNTER ) {
            mealStartCounter++;
            if (deviation > 0) {
                uam = 1;
            } else {
                uam = 0;
            }
            if ( type !== "uam" ) {
                process.stderr.write("u(");
                //glucoseDatum.uamAbsorption = "start";
                //console.error(glucoseDatum.uamAbsorption,"uannnounced meal absorption");
            }
            //console.error(mealStartCounter);
            type="uam";
          } else {
            if ( type === "uam" ) {
                process.stderr.write(")");
                //console.error("end unannounced meal absorption");
            }
            type = "non-meal"
          }
        }

        // Exclude meal-related deviations (carb absorption) from autosens
        if ( type === "non-meal" ) {
            if ( deviation > 0 ) {
                //process.stderr.write(` ${bg}`);
                process.stderr.write("+");
            } else if ( deviation === 0 ) {
                process.stderr.write("=");
            } else {
                //process.stderr.write(` ${bg}`);
                process.stderr.write("-");
            }
            avgDeltas.push(avgDelta);
            bgis.push(bgImpact);
            deviations.push(deviation);
            deviationSum += deviation;
        } else {
            process.stderr.write("x");
        }
        // add an extra negative deviation if a high temptarget is running and exercise mode is set
        if (profile.high_temptarget_raises_sensitivity === true || profile.exercise_mode === true) {
            const tempTarget = tempTargetRunning(inputs.temptargets, bgTime!)
            if (tempTarget) {
                //console.error(tempTarget)
            }
            if ( tempTarget! > EXERCISE_NORMAL_TARGET ) {
                // for a 110 temptarget, add a -0.5 deviation, for 160 add -3
                const tempDeviation=-(tempTarget!-EXERCISE_NORMAL_TARGET)/TEMP_TARGET_DEVIATION_DIVISOR;
                process.stderr.write("-");
                //console.error(tempDeviation)
                deviations.push(tempDeviation);
            }
        }

        const minutes = bgTime!.getMinutes();
        const hours = bgTime!.getHours();
        if ( minutes >= 0 && minutes < 5 ) {
            //console.error(bgTime);
            process.stderr.write(`${hours}h`);
            // add one neutral deviation every 2 hours to help decay over long exclusion periods
            if ( hours % 2 === 0 ) {
                deviations.push(0);
                process.stderr.write("=");
            }
        }
        let lookback = inputs.deviations;
        if (!lookback) { lookback = DEFAULT_AUTOSENS_LOOKBACK; }
        // only keep the last 96 non-excluded data points (8h+ for any exclusions)
        if (deviations.length > lookback) {
            deviations.shift();
        }
    }
    //console.error("");
    process.stderr.write(" ");
    //console.log(JSON.stringify(avgDeltas));
    //console.log(JSON.stringify(bgis));
    // when we have less than 8h worth of deviation data, add up to 90m of zero deviations
    // this dampens any large sensitivity changes detected based on too little data, without ignoring them completely
    console.error("");
    console.error("Using most recent",deviations.length,"deviations since",lastSiteChange);
    padDeviations(deviations, DEFAULT_AUTOSENS_LOOKBACK, MAX_ZERO_DEVIATION_PAD);
    const { pSensitive, pResistant } = analyzePercentiles(deviations, avgDeltas, bgis);
    return calculateAutosensRatio(
        deviations,
        deviationSum,
        pSensitive,
        pResistant,
        {
            sens: profile.sens as number,
            max_daily_basal: profile.max_daily_basal as number,
            autosens_min: profile.autosens_min as number,
            autosens_max: profile.autosens_max as number,
        }
    );
}

function tempTargetRunning(temptargets_data: TempTarget[] | undefined, time: Date): number | undefined {
    // sort tempTargets by date so we can process most recent first
    try {
        temptargets_data!.sort((a: TempTarget, b: TempTarget) => { return (new Date(a.created_at) < new Date(b.created_at)) as unknown as number });
    } catch (e) {
        //console.error("Could not sort temptargets_data.  Optional feature temporary targets disabled.");
    }
    //console.error(temptargets_data);
    //console.error(time);
    for (let i = 0; i < temptargets_data!.length; i++) {
        const start = new Date(temptargets_data![i].created_at);
        //console.error(start);
        const expires = new Date(start.getTime() + temptargets_data![i].duration * MS_PER_MINUTE);
        //console.error(expires);
        if (time >= new Date(temptargets_data![i].created_at) && temptargets_data![i].duration === 0) {
            // cancel temp targets
            //console.error(temptargets_data[i]);
            return 0;
        } else if (time >= new Date(temptargets_data![i].created_at) && time < expires ) {
            //console.error(temptargets_data[i]);
            const tempTarget = ( temptargets_data![i].targetTop! + temptargets_data![i].targetBottom! ) / 2;
            //console.error(tempTarget);
            return tempTarget;
        }
    }
}
