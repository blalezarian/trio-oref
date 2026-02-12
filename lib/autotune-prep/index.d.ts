interface AutotunePrepBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface AutotunePrepISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface AutotunePrepProfile {
  dia: number;
  curve?: string;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  current_basal?: number;
  basalprofile: AutotunePrepBasalProfileEntry[];
  min_5m_carbimpact: number;
  carb_ratio: number;
  sens?: number;
  isfProfile: AutotunePrepISFProfile;
  [key: string]: unknown;
}

interface AutotunePrepPumpProfile {
  basalprofile: AutotunePrepBasalProfileEntry[];
  [key: string]: unknown;
}

interface AutotunePrepInputs {
  history: unknown[];
  profile: AutotunePrepProfile;
  pumpprofile: AutotunePrepPumpProfile;
  carbs: unknown[];
  glucose: Array<Record<string, unknown>>;
  categorize_uam_as_basal?: boolean;
  tune_insulin_curve?: boolean;
}

interface DiaDeviation {
  dia: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface PeakDeviation {
  peak: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePrepGlucoseDatum {
  glucose: number;
  date: number;
  dateString: string;
  avgDelta: string;
  BGI: number;
  deviation: string;
  mealAbsorption?: string;
  mealCarbs?: number;
}

interface AutotunePrepCRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin?: number;
}

interface AutotunePrepResult {
  CRData: AutotunePrepCRDatum[];
  CSFGlucoseData: AutotunePrepGlucoseDatum[];
  ISFGlucoseData: AutotunePrepGlucoseDatum[];
  basalGlucoseData: AutotunePrepGlucoseDatum[];
  diaDeviations?: DiaDeviation[];
  peakDeviations?: PeakDeviation[];
}

declare function generate(inputs: AutotunePrepInputs): AutotunePrepResult;
export = generate;
