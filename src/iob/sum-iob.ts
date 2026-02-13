import { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import type { IobCalcProfile, IobTotalOpts, IobTotalResult } from './types';
import {
    MIN_DIA_HOURS,
    MIN_LONG_DIA_HOURS,
    RAPID_ACTING_PEAK,
    ULTRA_RAPID_PEAK,
    EXPONENTIAL_MIN_TD,
    MS_PER_HOUR,
} from '../shared/constants';
import { roundTo3dp, roundTo4dp } from '../utils/rounding';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bolus threshold below which insulin is considered basal (U) */
const BOLUS_DETECTION_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Sum up the IOB, activity, basal IOB, and bolus IOB across all active
 * treatments at a given point in time. Applies minimum DIA floors and
 * selects the appropriate insulin curve. Returns an empty object when
 * treatments is null.
 */
export function iobTotal(opts: IobTotalOpts, time: Date): IobTotalResult | Record<string, never> {

    const now = time.getTime();
    const iobCalc = opts.calculate;
    const treatments = opts.treatments;
    const profileData = opts.profile;
    let dia = profileData.dia;
    let peak = 0;
    let iob = 0;
    let basaliob = 0;
    let bolusiob = 0;
    let netbasalinsulin = 0;
    let bolusinsulin = 0;
    let activity = 0;
    if (!treatments) return {};

    // force minimum DIA of 3h
    if (dia < MIN_DIA_HOURS) {
        dia = MIN_DIA_HOURS;
    }

    const curveDefaults: Record<InsulinCurve, { requireLongDia: boolean; peak: number; tdMin?: number }> = {
        'bilinear': {
            requireLongDia: false,
            peak: RAPID_ACTING_PEAK // not really used, but prevents having to check later
        },
        'rapid-acting': {
            requireLongDia: true,
            peak: RAPID_ACTING_PEAK,
            tdMin: EXPONENTIAL_MIN_TD
        },
        'ultra-rapid': {
            requireLongDia: true,
            peak: ULTRA_RAPID_PEAK,
            tdMin: EXPONENTIAL_MIN_TD
        },
    };

    let curve: InsulinCurve = 'bilinear';

    if (profileData.curve !== undefined) {
        curve = profileData.curve.toLowerCase() as InsulinCurve;
    }

    if (!(curve in curveDefaults)) {
        console.log(`Unsupported curve function: "${curve}". Supported curves: "bilinear", "rapid-acting" (Novolog, Novorapid, Humalog, Apidra) and "ultra-rapid" (Fiasp). Defaulting to "rapid-acting".`);
        curve = 'rapid-acting';
    }

    const defaults = curveDefaults[curve];

    // Force minimum of 5 hour DIA when default requires a Long DIA.
    if (defaults.requireLongDia && dia < MIN_LONG_DIA_HOURS) {
        dia = MIN_LONG_DIA_HOURS;
    }

    peak = defaults.peak;

    treatments.forEach((treatment) => {
        if( treatment.date <= now ) {
            const dia_ago = now - dia*MS_PER_HOUR;
            if( treatment.date > dia_ago ) {
                // tIOB = total IOB
                const tIOB = iobCalc(treatment, time, curve, dia, peak, profileData);
                if (tIOB && tIOB.iobContrib) { iob += tIOB.iobContrib; }
                if (tIOB && tIOB.activityContrib) { activity += tIOB.activityContrib; }
                // basals look like either of these:
                // {"insulin":-0.05,"date":1507265512363.6365,"created_at":"2017-10-06T04:51:52.363Z"}
                // {"insulin":0.05,"date":1507266530000,"created_at":"2017-10-06T05:08:50.000Z"}
                // boluses look like:
                // {"timestamp":"2017-10-05T22:06:31-07:00","started_at":"2017-10-06T05:06:31.000Z","date":1507266391000,"insulin":0.5}
                if (treatment.insulin && tIOB && tIOB.iobContrib) {
                    if (treatment.insulin < BOLUS_DETECTION_THRESHOLD) {
                        basaliob += tIOB.iobContrib;
                        netbasalinsulin += treatment.insulin;
                    } else {
                        bolusiob += tIOB.iobContrib;
                        bolusinsulin += treatment.insulin;
                    }
                }
            }
        }
    });

    return {
        iob: roundTo3dp(iob),
        activity: roundTo4dp(activity),
        basaliob: roundTo3dp(basaliob),
        bolusiob: roundTo3dp(bolusiob),
        netbasalinsulin: roundTo3dp(netbasalinsulin),
        bolusinsulin: roundTo3dp(bolusinsulin),
        time: time
    };
}
