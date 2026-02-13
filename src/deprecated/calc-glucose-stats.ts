// Standalone CGM noise calculation utility — not part of the Trio Swift bundle.
// Only used by bin/oref0-calculate-glucose-noise.js CLI tool.

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

const calcStatsExports = {} as CalcGlucoseStats;

calcStatsExports.updateGlucoseStats = (options: UpdateGlucoseStatsOptions): GlucoseHistItem[] => {
  const hist = [...options.glucose_hist]
    .sort((a, b) => a.dateString < b.dateString ? -1 : a.dateString > b.dateString ? 1 : 0)
    .map((value: GlucoseHistItem): GlucoseHistItemWithDate => {
      return Object.assign(value, {
        readDateMills: value.dateString ? new Date(value.dateString).getTime() : Date.now(),
      });
    });

  if (hist && hist.length > 0) {
    const noise_val = stats.calcSensorNoise(null, hist, null, null);

    let ns_noise_val = stats.calcNSNoise(noise_val, hist);

    if ('noise' in options.glucose_hist[0]) {
      console.log("Glucose noise CGM reported level: ", options.glucose_hist[0].noise);
      ns_noise_val = Math.max(ns_noise_val, options.glucose_hist[0].noise!);
    }

    console.log("Glucose noise calculated: ", noise_val, " setting noise level to ", ns_noise_val);

    options.glucose_hist[0].noise = ns_noise_val;
  }

  return options.glucose_hist;
};

export default calcStatsExports;
