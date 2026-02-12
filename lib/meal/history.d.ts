interface MealHistoryInputs {
  history: unknown[];
  carbs: unknown[];
  profile: Record<string, unknown>;
}

interface MealInputEntry {
  timestamp: string;
  carbs?: number;
  nsCarbs?: number;
  bwCarbs?: number;
  journalCarbs?: number;
  bolus?: number;
}

declare function findMealInputs(inputs: MealHistoryInputs): MealInputEntry[];
export = findMealInputs;
