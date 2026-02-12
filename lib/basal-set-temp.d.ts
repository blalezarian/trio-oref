interface TempBasalProfile {
  current_basal: number;
  max_daily_basal: number;
  max_basal: number;
  max_daily_safety_multiplier: number | null;
  current_basal_safety_multiplier: number | null;
  skip_neutral_temps?: boolean;
  model?: string;
}

interface TempBasalResult {
  reason: string;
  duration?: number;
  rate?: number;
}

interface CurrentTemp {
  duration: number;
  rate: number;
}

interface TempBasalFunctions {
  getMaxSafeBasal(profile: TempBasalProfile): number;
  setTempBasal(
    rate: number,
    duration: number,
    profile: TempBasalProfile,
    rT: TempBasalResult,
    currenttemp?: CurrentTemp,
  ): TempBasalResult;
}

declare const tempBasalFunctions: TempBasalFunctions;
export = tempBasalFunctions;
