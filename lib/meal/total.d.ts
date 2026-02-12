interface RecentCarbsOpts {
  treatments: unknown[] | null;
  profile: Record<string, unknown>;
  pumphistory: unknown[];
  glucose?: unknown[];
  basalprofile: unknown[];
}

interface RecentCarbsResult {
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

declare function recentCarbs(opts: RecentCarbsOpts, time: Date): RecentCarbsResult | Record<string, never>;
export = recentCarbs;
