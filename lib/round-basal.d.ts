interface RoundBasalProfile {
  model?: string;
}

declare function round_basal(basal: number, profile?: RoundBasalProfile): number;
export = round_basal;
