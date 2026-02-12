interface CarbAbsorptionInputs {
  glucose_data: Array<Record<string, unknown>>;
  iob_inputs: {
    profile: Record<string, unknown>;
    history: Array<Record<string, unknown>>;
    clock: string | Date;
  };
  basalprofile: Array<Record<string, unknown>>;
  mealTime: number | string | Date;
  ciTime?: number | string | Date;
}

interface CarbAbsorptionResult {
  carbsAbsorbed: number;
  currentDeviation: number;
  maxDeviation: number;
  minDeviation: number;
  slopeFromMaxDeviation: number;
  slopeFromMinDeviation: number;
  allDeviations: number[];
}

declare function detectCarbAbsorption(inputs: CarbAbsorptionInputs): CarbAbsorptionResult;
export = detectCarbAbsorption;
