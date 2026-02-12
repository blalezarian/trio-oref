interface HistoryBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface HistoryProfile {
  dia: number;
  curve?: string;
  basalprofile: HistoryBasalProfileEntry[];
  current_basal: number;
  max_daily_basal?: number;
  min_bg?: number;
  max_bg?: number;
  exercise_mode?: boolean;
  temptargetSet?: boolean;
  half_basal_exercise_target?: number;
  suspend_zeros_iob?: boolean;
}

interface HistoryInputs {
  clock: string;
  history: unknown[];
  history24?: unknown[];
  profile: HistoryProfile;
  autosens?: { ratio: number };
}

interface HistoryTreatment {
  insulin?: number;
  date: number;
  created_at?: Date;
  started_at?: Date;
  timestamp?: string;
  rate?: number;
  duration?: number;
}

declare function calcTempTreatments(
  inputs: HistoryInputs,
  zeroTempDuration?: number,
): HistoryTreatment[];

export = calcTempTreatments;
