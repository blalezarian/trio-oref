interface DosedOpts {
  start: Date;
  end: Date;
  treatments: DosedTreatment[] | undefined;
  profile: Record<string, unknown>;
}

interface DosedTreatment {
  insulin?: number | null;
  date: number;
}

interface DosedResult {
  insulin: number;
}

declare function insulinDosed(opts: DosedOpts): DosedResult | Record<string, never>;
export = insulinDosed;
