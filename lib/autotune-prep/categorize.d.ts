interface CategorizeGlucoseEntry {
  glucose?: number;
  sgv?: number;
  date?: number;
  displayTime?: string;
  dateString?: string;
}

interface CategorizeBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface CategorizeISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface CategorizeProfile {
  dia: number;
  curve?: string;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  current_basal?: number;
  basalprofile: CategorizeBasalProfileEntry[];
  min_5m_carbimpact: number;
  carb_ratio: number;
  sens?: number;
  isfProfile: CategorizeISFProfile;
  currentBasal?: number;
  [key: string]: unknown;
}

interface CategorizeOpts {
  treatments: Array<Record<string, unknown>>;
  profile: CategorizeProfile;
  pumpHistory: unknown[];
  glucose: CategorizeGlucoseEntry[];
  basalprofile: CategorizeBasalProfileEntry[];
  pumpbasalprofile: CategorizeBasalProfileEntry[];
  categorize_uam_as_basal?: boolean;
}

interface CategorizeGlucoseDatum {
  glucose: number;
  date: number;
  dateString: string;
  avgDelta: string;
  BGI: number;
  deviation: string;
  mealAbsorption?: string;
  mealCarbs?: number;
  uamAbsorption?: string;
}

interface CRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin?: number;
}

interface CategorizeResult {
  CRData: CRDatum[];
  CSFGlucoseData: CategorizeGlucoseDatum[];
  ISFGlucoseData: CategorizeGlucoseDatum[];
  basalGlucoseData: CategorizeGlucoseDatum[];
}

declare function categorizeBGDatums(opts: CategorizeOpts): CategorizeResult;
export = categorizeBGDatums;
