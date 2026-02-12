interface IobIndexBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface IobIndexProfile {
  dia: number;
  curve?: string;
  basalprofile: IobIndexBasalProfileEntry[];
  current_basal: number;
  max_daily_basal?: number;
  min_bg?: number;
  max_bg?: number;
  exercise_mode?: boolean;
  temptargetSet?: boolean;
  half_basal_exercise_target?: number;
  suspend_zeros_iob?: boolean;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
}

interface IobIndexInputs {
  clock: string;
  history: unknown[];
  history24?: unknown[];
  profile: IobIndexProfile;
  autosens?: { ratio: number };
}

interface IobIndexEntry {
  iob: number;
  activity: number;
  basaliob: number;
  bolusiob: number;
  netbasalinsulin: number;
  bolusinsulin: number;
  time: Date;
  iobWithZeroTemp?: IobIndexEntry;
  lastBolusTime?: number;
  lastTemp?: {
    date: number;
    rate?: number;
    duration?: number;
    started_at?: Date | string;
  };
}

interface IobIndexTreatment {
  insulin?: number;
  date: number;
  created_at?: Date;
  started_at?: Date;
  timestamp?: string;
  rate?: number;
  duration?: number;
}

declare function generate(
  inputs: IobIndexInputs,
  currentIOBOnly?: boolean,
  treatments?: IobIndexTreatment[],
): IobIndexEntry[];

export = generate;
