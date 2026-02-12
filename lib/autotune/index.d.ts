interface AutotuneBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
  untuned?: number;
}

interface AutotuneISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface AutotunePreviousProfile {
  basalprofile: AutotuneBasalProfileEntry[];
  isfProfile: AutotuneISFProfile;
  sens?: number;
  carb_ratio: number;
  csf?: number;
  dia: number;
  curve?: string;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  min_5m_carbimpact?: number;
  [key: string]: unknown;
}

interface AutotunePumpProfile {
  basalprofile: AutotuneBasalProfileEntry[];
  isfProfile?: AutotuneISFProfile;
  carb_ratio?: number;
  autosens_min?: number;
  autosens_max?: number;
  autotune_isf_adjustmentFraction?: number;
  [key: string]: unknown;
}

interface AutotuneGlucoseDatum {
  glucose?: number;
  date?: number;
  displayTime?: string;
  dateString?: string;
  deviation: string;
  BGI: number;
  avgDelta: string;
  mealAbsorption?: string;
  mealCarbs?: number;
}

interface AutotuneCRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin: number;
  CRInsulinTotal?: number;
}

interface AutotuneDiaDeviation {
  dia: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePeakDeviation {
  peak: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePreppedGlucose {
  CRData: AutotuneCRDatum[];
  CSFGlucoseData: AutotuneGlucoseDatum[];
  ISFGlucoseData: AutotuneGlucoseDatum[];
  basalGlucoseData: AutotuneGlucoseDatum[];
  diaDeviations?: AutotuneDiaDeviation[];
  peakDeviations?: AutotunePeakDeviation[];
}

interface AutotuneInputs {
  previousAutotune: AutotunePreviousProfile;
  pumpProfile: AutotunePumpProfile;
  preppedGlucose: AutotunePreppedGlucose;
}

declare function tuneAllTheThings(inputs: AutotuneInputs): AutotunePreviousProfile | undefined;
export = tuneAllTheThings;
