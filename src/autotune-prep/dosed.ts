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

function insulinDosed(opts: DosedOpts): DosedResult | Record<string, never> {

    const start = opts.start.getTime();
    const end = opts.end.getTime();
    const treatments = opts.treatments;
    const profile_data = opts.profile;
    let insulinDosed = 0;
    if (!treatments) {
        console.error("No treatments to process.");
        return {};
    }

    treatments.forEach((treatment: DosedTreatment) => {
        //console.error(treatment);
        if(treatment.insulin && treatment.date > start && treatment.date <= end) {
            insulinDosed += treatment.insulin;
        }
    });
    //console.error(insulinDosed);

    return {
        insulin: Math.round( insulinDosed * 1000 ) / 1000
    };
}

export default insulinDosed;
