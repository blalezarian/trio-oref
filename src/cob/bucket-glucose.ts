import type { GlucoseEntry, BucketedGlucose } from '../types/index';
import {
    MIN_VALID_GLUCOSE_MGDL,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    MS_PER_5_MIN,
    PRED_INTERVAL_MINUTES,
    BUCKETING_MERGE_THRESHOLD_MIN,
} from '../constants';

/** Time window for CI-mode lookback (45 minutes in ms) */
const CI_LOOKBACK_MS = 45 * MS_PER_MINUTE;
/** Maximum interpolation gap cap (4 hours in minutes) */
const MAX_INTERPOLATION_GAP_MINUTES = 240;
/** Elapsed-minutes gap above which BG data is interpolated */
const BUCKETING_GAP_THRESHOLD_MIN = 8;

/** Bucket glucose data with 5-minute interpolation for gaps > 8 minutes */
export function bucketGlucoseWithInterpolation(
    glucose_data: GlucoseEntry[],
    mealTime: Date,
    ciTime: Date,
    maxMealAbsorptionTime: number
): BucketedGlucose[] {
    const bucketed_data: BucketedGlucose[] = [];
    bucketed_data[0] = glucose_data[0];
    let j=0;
    let foundPreMealBG = false;
    let lastbgi = 0;

    if (! glucose_data[0].glucose || glucose_data[0].glucose < MIN_VALID_GLUCOSE_MGDL) {
      lastbgi = -1;
    }

    let bgTime: Date | undefined;
    let lastbgTime: Date | undefined;
    for (let i=1; i < glucose_data.length; ++i) {
        if (glucose_data[i].display_time) {
            bgTime = new Date(glucose_data[i].display_time!.replace('T', ' '));
        } else if (glucose_data[i].dateString) {
            bgTime = new Date(glucose_data[i].dateString!);
        } else { console.error("Could not determine BG time"); }
        if (! glucose_data[i].glucose || glucose_data[i].glucose! < MIN_VALID_GLUCOSE_MGDL) {
            continue;
        }
        // only consider BGs for 6h after a meal for calculating COB
        const hoursAfterMeal = (Number(bgTime)-Number(mealTime))/MS_PER_HOUR;
        if (hoursAfterMeal > maxMealAbsorptionTime || foundPreMealBG) {
            continue;
        } else if (hoursAfterMeal < 0) {
            foundPreMealBG = true;
        }
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
        if(Math.abs(elapsed_minutes) > BUCKETING_GAP_THRESHOLD_MIN) {
            // interpolate missing data points
            let lastbg = glucose_data[lastbgi].glucose!;
            // cap interpolation at a maximum of 4h
            elapsed_minutes = Math.min(MAX_INTERPOLATION_GAP_MINUTES,Math.abs(elapsed_minutes));
            while(elapsed_minutes > PRED_INTERVAL_MINUTES) {
                const previousbgTime = new Date(lastbgTime!.getTime() - MS_PER_5_MIN);
                j++;
                bucketed_data[j] = {} as BucketedGlucose;
                bucketed_data[j].date = previousbgTime.getTime();
                const gapDelta = glucose_data[i].glucose! - lastbg;
                const previousbg = lastbg + (PRED_INTERVAL_MINUTES/elapsed_minutes * gapDelta);
                bucketed_data[j].glucose = Math.round(previousbg);

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
    }

    return bucketed_data;
}
