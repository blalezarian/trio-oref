interface Treatment {
  insulin?: number;
  date: number;
}

interface IobCalcProfile {
  curve?: string;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
}

interface IobContrib {
  activityContrib: number;
  iobContrib: number;
}

declare function iobCalc(
  treatment: Treatment,
  time: Date | undefined,
  curve: string,
  dia: number,
  peak: number,
  profile: IobCalcProfile,
): IobContrib | Record<string, never>;

export = iobCalc;
