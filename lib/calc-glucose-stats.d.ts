interface GlucoseHistItem {
  glucose: number;
  dateString: string;
  noise?: number;
  [key: string]: unknown;
}

interface UpdateGlucoseStatsOptions {
  glucose_hist: GlucoseHistItem[];
}

interface CalcGlucoseStats {
  updateGlucoseStats(options: UpdateGlucoseStatsOptions): GlucoseHistItem[];
}

declare const calcGlucoseStats: CalcGlucoseStats;
export = calcGlucoseStats;
