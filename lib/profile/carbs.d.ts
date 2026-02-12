interface CarbRatioScheduleEntry {
  offset: number;
  ratio: number;
}

interface CarbRatioData {
  units: string;
  schedule?: CarbRatioScheduleEntry[];
}

interface CarbsInputs {
  carbratio?: CarbRatioData;
}

interface CarbRatioLookup {
  (inputs: CarbsInputs, profile: Record<string, unknown>, now?: Date): number | undefined;
  carbRatioLookup: CarbRatioLookup;
}

declare const carbRatioLookup: CarbRatioLookup;
export = carbRatioLookup;
