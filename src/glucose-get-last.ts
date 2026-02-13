import type { GlucoseEntry, GlucoseStatus } from './types/index';
import { MS_PER_MINUTE, PRED_INTERVAL_MINUTES, MIN_VALID_GLUCOSE_MGDL } from './constants';

/** Lower bound (minutes ago) for averaging current BG reading */
const NOW_AVERAGING_MIN_MINUTES = -2;
/** Upper bound (minutes ago) for averaging current BG reading */
const NOW_AVERAGING_MAX_MINUTES = 2.5;
/** Upper bound (minutes ago) for short delta calculations (~5-15m) */
const SHORT_DELTA_MAX_MINUTES = 17.5;
/** Upper bound (minutes ago) for last delta calculations (~5m) */
const LAST_DELTA_MAX_MINUTES = 7.5;
/** Upper bound (minutes ago) for long delta calculations (~20-40m) */
const LONG_DELTA_MAX_MINUTES = 42.5;
/** Scale factor for rounding to 2 decimal places */
const ROUND_SCALE_2DP = 100;

function getDateFromEntry(entry: GlucoseEntry): number {
  return entry.date || Date.parse(entry.display_time as string) || Date.parse(entry.dateString as string);
}

const getLastGlucose = (data: GlucoseEntry[]): GlucoseStatus => {
    data = data.filter((obj) => {
      return obj.glucose || obj.sgv;
    }).map(function prepGlucose (obj) {
        //Support the NS sgv field to avoid having to convert in a custom way
        obj.glucose = obj.glucose || obj.sgv;
        if ( obj.glucose !== null ) {
            return obj;
        }
    }) as GlucoseEntry[];

    const now = data[0];
    let now_date = getDateFromEntry(now);
    const last_deltas: number[] = [];
    const short_deltas: number[] = [];
    const long_deltas: number[] = [];
    let last_cal = 0;

    for (let i=1; i < data.length; i++) {
        // if we come across a cal record, don't process any older SGVs
        if (data[i] !== undefined && data[i].type === "cal") {
            last_cal = i;
            break;
        }
        // only use data from the same device as the most recent BG data point
        if (data[i] !== undefined && data[i].glucose! >= MIN_VALID_GLUCOSE_MGDL && data[i].device === now.device) {
            const then = data[i];
            const then_date = getDateFromEntry(then);
            let avgdelta = 0;
            let minutesago: number;
            if (then_date !== undefined && now_date !== undefined) {
                minutesago = Math.round( (now_date - then_date) / MS_PER_MINUTE );
                // multiply by 5 to get the same units as delta, i.e. mg/dL/5m
                const change = now.glucose! - then.glucose!;
                avgdelta = change/minutesago * PRED_INTERVAL_MINUTES;
            } else { console.error("Error: date field not found: cannot calculate avgdelta"); }
            // use the average of all data points in the last 2.5m for all further "now" calculations
            if (NOW_AVERAGING_MIN_MINUTES < minutesago! && minutesago! <= NOW_AVERAGING_MAX_MINUTES) {
                now.glucose = ( now.glucose! + then.glucose! ) / 2;
                now_date = ( now_date + then_date ) / 2;
            // short_deltas are calculated from everything ~5-15 minutes ago
            } else if (NOW_AVERAGING_MAX_MINUTES < minutesago! && minutesago! <= SHORT_DELTA_MAX_MINUTES) {
                short_deltas.push(avgdelta);
                // last_deltas are calculated from everything ~5 minutes ago
                if (NOW_AVERAGING_MAX_MINUTES < minutesago! && minutesago! < LAST_DELTA_MAX_MINUTES) {
                    last_deltas.push(avgdelta);
                }
            // long_deltas are calculated from everything ~20-40 minutes ago
            } else if (SHORT_DELTA_MAX_MINUTES < minutesago! && minutesago! < LONG_DELTA_MAX_MINUTES) {
                long_deltas.push(avgdelta);
            }
        }
    }
    let last_delta = 0;
    let short_avgdelta = 0;
    let long_avgdelta = 0;
    if (last_deltas.length > 0) {
        last_delta = last_deltas.reduce((a, b) => { return a + b; }) / last_deltas.length;
    }
    if (short_deltas.length > 0) {
        short_avgdelta = short_deltas.reduce((a, b) => { return a + b; }) / short_deltas.length;
    }
    if (long_deltas.length > 0) {
        long_avgdelta = long_deltas.reduce((a, b) => { return a + b; }) / long_deltas.length;
    }

    return {
        delta: Math.round( last_delta * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
        , glucose: Math.round( now.glucose! * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
        , noise: Math.round(now.noise!)
        , short_avgdelta: Math.round( short_avgdelta * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
        , long_avgdelta: Math.round( long_avgdelta * ROUND_SCALE_2DP ) / ROUND_SCALE_2DP
        , date: now_date
        , last_cal: last_cal
        , device: now.device
    };
};

export default getLastGlucose;
