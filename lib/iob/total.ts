import { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import {
    MIN_DIA_HOURS,
    MIN_LONG_DIA_HOURS,
    RAPID_ACTING_PEAK,
    ULTRA_RAPID_PEAK,
    EXPONENTIAL_MIN_TD,
    MS_PER_HOUR,
} from '../constants';

/** Bolus threshold below which insulin is considered basal (U) */
const BOLUS_DETECTION_THRESHOLD = 0.1;
/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;
/** Rounding scale for 4 decimal places */
const ROUND_SCALE_4DP = 10000;

interface IobCalcProfile {
    dia: number;
    curve?: InsulinCurve;
    useCustomPeakTime?: boolean;
    insulinPeakTime?: number;
}

interface IobTotalOpts {
    treatments: Treatment[] | null;
    profile: IobCalcProfile;
    calculate: (
        treatment: Treatment,
        time: Date,
        curve: InsulinCurve,
        dia: number,
        peak: number,
        profile: IobCalcProfile,
    ) => IOBContribution | Record<string, never>;
}

interface IobTotalResult {
    [key: string]: unknown;
    iob: number;
    activity: number;
    basaliob: number;
    bolusiob: number;
    netbasalinsulin: number;
    bolusinsulin: number;
    time: Date;
}

function iobTotal(opts: IobTotalOpts, time: Date): IobTotalResult | Record<string, never> {

    var now = time.getTime();
    var iobCalc = opts.calculate;
    var treatments = opts.treatments;
    var profile_data = opts.profile;
    var dia = profile_data.dia;
    var peak = 0;
    var iob = 0;
    var basaliob = 0;
    var bolusiob = 0;
    var netbasalinsulin = 0;
    var bolusinsulin = 0;
    //var bolussnooze = 0;
    var activity = 0;
    if (!treatments) return {};
    //if (typeof time === 'undefined') {
        //var time = new Date();
    //}

    // force minimum DIA of 3h
    if (dia < MIN_DIA_HOURS) {
        //console.error("Warning; adjusting DIA from",dia,"to minimum of 3 hours");
        dia = MIN_DIA_HOURS;
    }

    var curveDefaults: Record<InsulinCurve, { requireLongDia: boolean; peak: number; tdMin?: number }> = {
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

    var curve: InsulinCurve = 'bilinear';

    if (profile_data.curve !== undefined) {
        curve = profile_data.curve.toLowerCase() as InsulinCurve;
    }

    if (!(curve in curveDefaults)) {
        console.error('Unsupported curve function: "' + curve + '". Supported curves: "bilinear", "rapid-acting" (Novolog, Novorapid, Humalog, Apidra) and "ultra-rapid" (Fiasp). Defaulting to "rapid-acting".');
        curve = 'rapid-acting';
    }

    var defaults = curveDefaults[curve];

    // Force minimum of 5 hour DIA when default requires a Long DIA.
    if (defaults.requireLongDia && dia < MIN_LONG_DIA_HOURS) {
        //console.error('Pump DIA must be set to 5 hours or more with the new curves, please adjust your pump. Defaulting to 5 hour DIA.');
        dia = MIN_LONG_DIA_HOURS;
    }

    peak = defaults.peak;

    treatments.forEach(function(treatment) {
        if( treatment.date <= now ) {
            var dia_ago = now - dia*MS_PER_HOUR;
            if( treatment.date > dia_ago ) {
                // tIOB = total IOB
                var tIOB = iobCalc(treatment, time, curve, dia, peak, profile_data);
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
                //console.error(JSON.stringify(treatment));
            }
        } // else { console.error("ignoring future treatment:",treatment); }
    });

    return {
        iob: Math.round(iob * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
        activity: Math.round(activity * ROUND_SCALE_4DP) / ROUND_SCALE_4DP,
        basaliob: Math.round(basaliob * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
        bolusiob: Math.round(bolusiob * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
        netbasalinsulin: Math.round(netbasalinsulin * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
        bolusinsulin: Math.round(bolusinsulin * ROUND_SCALE_3DP) / ROUND_SCALE_3DP,
        time: time
    };
}

export default iobTotal;
