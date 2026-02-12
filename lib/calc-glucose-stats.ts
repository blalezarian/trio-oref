// Standalone CGM noise calculation utility — not part of the Trio Swift bundle.
// Only used by bin/oref0-calculate-glucose-noise.js CLI tool.

import moment from 'moment';
import _ from 'lodash';
import stats from './glucose-stats';

interface GlucoseHistItem {
  glucose: number;
  dateString: string;
  noise?: number;
  [key: string]: unknown;
}

interface GlucoseHistItemWithDate extends GlucoseHistItem {
  readDateMills: number;
}

interface UpdateGlucoseStatsOptions {
  glucose_hist: GlucoseHistItem[];
}

interface CalcGlucoseStats {
  updateGlucoseStats(options: UpdateGlucoseStatsOptions): GlucoseHistItem[];
}

var calcStatsExports = {} as CalcGlucoseStats;

calcStatsExports.updateGlucoseStats = (options: UpdateGlucoseStatsOptions): GlucoseHistItem[] => {
  var hist = _.map(_.sortBy(options.glucose_hist, 'dateString'), function readDate(value: GlucoseHistItem): GlucoseHistItemWithDate {
      return Object.assign(value, { readDateMills: moment(value.dateString).valueOf() });
    });

  if (hist && hist.length > 0) {
    var noise_val = stats.calcSensorNoise(null, hist, null, null);

    var ns_noise_val = stats.calcNSNoise(noise_val, hist);

    if ('noise' in options.glucose_hist[0]) {
      console.error("Glucose noise CGM reported level: ", options.glucose_hist[0].noise);
      ns_noise_val = Math.max(ns_noise_val, options.glucose_hist[0].noise!);
    }

    console.error("Glucose noise calculated: ", noise_val, " setting noise level to ", ns_noise_val);

    options.glucose_hist[0].noise = ns_noise_val;
  }

  return options.glucose_hist;
};

export default calcStatsExports;
