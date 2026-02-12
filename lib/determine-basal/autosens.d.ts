interface AutosensInputs {
  glucose_data: Array<Record<string, unknown>>;
  iob_inputs: {
    profile: Record<string, unknown>;
    history: Array<Record<string, unknown>>;
    clock: string | Date;
  };
  basalprofile: Array<Record<string, unknown>>;
  carbs: Array<Record<string, unknown>>;
  temptargets?: unknown;
  retrospective?: boolean;
  deviations?: number;
}

interface AutosensResult {
  ratio: number;
  newisf: number;
}

declare function detectSensitivity(inputs: AutosensInputs): AutosensResult;
export = detectSensitivity;
