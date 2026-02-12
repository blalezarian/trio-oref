interface Treatment {
  _type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface BolusResult {
  eventType: string;
  insulin?: string;
  carbs?: string;
  ratio?: string;
  bg?: string;
  glucose?: string;
  glucoseType?: string;
  duration?: string;
  notes?: string;
  created_at?: string;
  timestamp?: string;
  [key: string]: unknown;
}

declare function reduce(treatments: Treatment[]): BolusResult[];
export = reduce;
