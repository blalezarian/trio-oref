interface GlucoseEntry {
  glucose?: number;
  sgv?: number;
  date?: number;
  display_time?: string;
  dateString?: string;
  device?: string;
  noise?: number;
  type?: string;
}

interface GlucoseStatus {
  delta: number;
  glucose: number;
  noise: number;
  short_avgdelta: number;
  long_avgdelta: number;
  date: number;
  last_cal: number;
  device: string | undefined;
}

declare function getLastGlucose(data: GlucoseEntry[]): GlucoseStatus;
export = getLastGlucose;
