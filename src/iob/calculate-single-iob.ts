import { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import type { IobCalcProfile } from './types';
import { MS_PER_MINUTE } from '../shared/constants';
import { iobCalcBilinear } from './curve-bilinear';
import { iobCalcExponential } from './curve-exponential';

/**
 * Calculate the IOB and activity contribution of a single treatment at a given
 * point in time. Dispatches to the bilinear or exponential curve model based
 * on the curve parameter. Returns an empty object when the treatment has no
 * insulin (e.g. a temp basal record with no bolus).
 */
export function iobCalc(
    treatment: Treatment,
    time: Date = new Date(),
    curve: InsulinCurve,
    dia: number,
    peak: number,
    profile: IobCalcProfile,
): IOBContribution | Record<string, never> {
    // iobCalc returns two variables:
    //   activityContrib = units of treatment.insulin used in previous minute
    //   iobContrib = units of treatment.insulin still remaining at a given point in time
    // ("Contrib" is used because these are the amounts contributed from potentially
    //  multiple treatment.insulin dosages -- totals are calculated in sum-iob.ts)
    //
    // Variables can be calculated using either:
    //   A bilinear insulin action curve (which only takes duration of insulin activity (dia) as an input parameter) or
    //   An exponential insulin action curve (which takes both a dia and a peak parameter)
    // (which functional form to use is specified in the user's profile)

    if (!treatment.insulin) {
        return {};
    }

    const bolusTime = new Date(treatment.date);
    const minsAgo = Math.round((time.getTime() - bolusTime.getTime()) / MS_PER_MINUTE);

    if (curve === 'bilinear') {
        return iobCalcBilinear(treatment, minsAgo, dia);  // no user-specified peak with this model
    }

    return iobCalcExponential(treatment, minsAgo, dia, peak, profile);
}

