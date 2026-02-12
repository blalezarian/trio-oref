interface IobTotalTreatment {
  insulin?: number;
  date: number;
  started_at?: string;
}

interface IobTotalProfile {
  dia: number;
  curve?: string;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
}

interface IobTotalOpts {
  treatments: IobTotalTreatment[] | null;
  profile: IobTotalProfile;
  calculate: (
    treatment: IobTotalTreatment,
    time: Date,
    curve: string,
    dia: number,
    peak: number,
    profile: IobTotalProfile,
  ) => { activityContrib?: number; iobContrib?: number } | Record<string, never>;
}

interface IobTotalResult {
  [key: string]: unknown;
  iob: number;
  activity: number;
  basaliob: number;
  bolusiob: number;
  netbasalinsulin: number;
  bolusinsulin: number;
  time: Date;
}

declare function iobTotal(
  opts: IobTotalOpts,
  time: Date,
): IobTotalResult | Record<string, never>;

export = iobTotal;
