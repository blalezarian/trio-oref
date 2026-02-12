interface MealGenerateInputs {
  history: unknown[];
  carbs: unknown[];
  profile: Record<string, unknown>;
  clock: string;
  glucose?: unknown[];
  basalprofile: unknown[];
}

interface MealData {
  carbs: number;
  nsCarbs: number;
  bwCarbs: number;
  journalCarbs: number;
  mealCOB: number;
  currentDeviation: number;
  maxDeviation: number;
  minDeviation: number;
  slopeFromMaxDeviation: number;
  slopeFromMinDeviation: number;
  allDeviations: string;
  lastCarbTime: number;
  bwFound: boolean;
}

declare function generate(inputs: MealGenerateInputs): MealData | Record<string, never>;
export = generate;
