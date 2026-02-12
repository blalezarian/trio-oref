interface RawGlucoseEntry {
  type?: string;
  glucose?: number;
  sgv?: number;
  unfiltered?: number | string;
  filtered?: number | string;
  raw?: number;
  noise?: number;
  fromRaw?: boolean;
  [key: string]: unknown;
}

interface RawGlucoseCal {
  scale: number | string;
  intercept: number | string;
  slope: number | string;
  [key: string]: unknown;
}

declare function withRawGlucose(
  entry: RawGlucoseEntry,
  cals: RawGlucoseCal[] | null | undefined,
  maxRaw?: number,
): RawGlucoseEntry;
export = withRawGlucose;
