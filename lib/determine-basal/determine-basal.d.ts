interface GlucoseStatus {
  glucose: number;
  noise?: number;
  delta: number;
  short_avgdelta: number;
  long_avgdelta: number;
  cgmFlatMinutes?: number;
  date?: number;
  [key: string]: unknown;
}

interface CurrentTemp {
  duration: number;
  rate: number;
  [key: string]: unknown;
}

interface IOBData {
  iob: number;
  activity: number;
  basaliob: number;
  bolusiob: number;
  netbasalinsulin: number;
  hightempinsulin: number;
  lastBolusTime?: number;
  lastTemp?: Record<string, unknown>;
  iobWithZeroTemp?: Record<string, unknown>;
  [key: string]: unknown;
}

interface DetermineBasalProfile {
  current_basal: number;
  max_daily_basal: number;
  max_basal: number;
  min_bg: number;
  max_bg: number;
  target_bg: number;
  sens: number;
  carb_ratio: number;
  dia: number;
  model?: string;
  out_units?: string;
  temptargetSet?: boolean;
  [key: string]: unknown;
}

interface AutosensData {
  ratio: number;
  [key: string]: unknown;
}

interface MealData {
  carbs: number;
  mealCOB: number;
  [key: string]: unknown;
}

interface TempBasalFunctions {
  getMaxSafeBasal(profile: Record<string, unknown>): number;
  setTempBasal(
    rate: number,
    duration: number,
    profile: Record<string, unknown>,
    rT: Record<string, unknown>,
    currenttemp?: Record<string, unknown>,
  ): Record<string, unknown>;
}

interface TrioCustomVariables {
  useOverride?: boolean;
  overridePercentage?: number;
  overrideTarget?: number;
  advancedSettings?: boolean;
  isfAndCr?: boolean;
  isf?: number;
  cr?: number;
  smbIsOff?: boolean;
  smbIsScheduledOff?: boolean;
  start?: number;
  end?: number;
  smbMinutes?: number;
  uamMinutes?: number;
  currentTDD?: number;
  average_total_data?: number;
  weightedAverage?: number;
  past2hoursAverage?: number;
  date?: number;
  overrideMaxIOB?: number;
  duration?: number;
  [key: string]: unknown;
}

interface Preferences {
  useNewFormula?: boolean;
  [key: string]: unknown;
}

interface DetermineBasalResult {
  error?: string;
  reason?: string;
  rate?: number;
  duration?: number;
  temp?: string;
  deliverAt?: string | Date;
  eventualBG?: number;
  predBGs?: Record<string, number[]>;
  COB?: number;
  IOB?: number;
  BGI?: number;
  deviation?: number;
  CR?: number;
  target_bg?: number;
  tick?: string | number;
  insulinReq?: number;
  reservoir?: number;
  units?: number;
  variable_sens?: number;
  carbsReq?: number;
  manualBolusErrorString?: number;
  minGuardBG?: number;
  insulinForManualBolus?: number;
  minDelta?: number;
  expectedDelta?: number;
  sensitivityRatio?: number;
  [key: string]: unknown;
}

declare function determine_basal(
  glucose_status: GlucoseStatus,
  currenttemp: CurrentTemp,
  iob_data: IOBData,
  profile: DetermineBasalProfile,
  autosens_data: AutosensData | null,
  meal_data: MealData,
  tempBasalFunctions: TempBasalFunctions,
  microBolusAllowed: boolean,
  reservoir_data: number | null,
  currentTime: string | Date | null,
  pumphistory: Array<Record<string, unknown>> | null,
  preferences: Preferences,
  basalprofile: Array<Record<string, unknown>>,
  trio_custom_variables?: TrioCustomVariables,
  middleWare?: ((...args: unknown[]) => unknown) | null,
): DetermineBasalResult;

export = determine_basal;
