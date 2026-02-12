interface GlucoseHistEntry {
  glucose: number;
  readDateMills: number;
  unfiltered?: number;
  [key: string]: unknown;
}

interface CalibrationData {
  scale: number;
  intercept: number;
  slope: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalcGlucoseFn = ((entry: any, lastCal: any) => number) | null;

interface SgvEntry {
  glucose: number;
  readDateMills: number;
  unfiltered?: number;
}

interface GlucoseStats {
  calcSensorNoise(
    calcGlucose: CalcGlucoseFn,
    glucoseHist: GlucoseHistEntry[],
    lastCal: CalibrationData | null,
    sgv: SgvEntry | null,
  ): number;

  calcTrend(
    calcGlucose: CalcGlucoseFn,
    glucoseHist: GlucoseHistEntry[],
    lastCal: CalibrationData | null,
    sgv: SgvEntry | null,
  ): number;

  calcNSNoise(noise: number, glucoseHist: Array<{ glucose: number }>): number;

  NSNoiseString(nsNoise: number | undefined): string;
}

declare const glucoseStats: GlucoseStats;
export = glucoseStats;
