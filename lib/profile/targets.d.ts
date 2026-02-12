interface BGTarget {
  offset?: number;
  low: number;
  high: number;
  min_bg?: number;
  max_bg?: number;
  temptargetSet?: boolean;
}

interface BGTargetsData {
  user_preferred_units?: string;
  targets: BGTarget[];
  raw?: unknown;
}

interface TempTarget {
  created_at: string;
  duration: number;
  targetTop?: number;
  targetBottom?: number;
}

interface TargetsInputs {
  targets: BGTargetsData;
  temptargets: unknown;
}

interface TargetsProfile {
  target_bg?: number;
  [key: string]: unknown;
}

interface BGTargetsLookup {
  (inputs: TargetsInputs, profile: TargetsProfile): BGTarget;
  bgTargetsLookup: BGTargetsLookup;
  lookup: (inputs: TargetsInputs, profile: TargetsProfile) => BGTarget;
  bound_target_range: (target: BGTarget) => BGTarget;
}

declare const bgTargetsLookup: BGTargetsLookup;
export = bgTargetsLookup;
