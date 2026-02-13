import { Treatment, IOBContribution, InsulinCurve } from '../types/index';
import type { IobCalcProfile } from './types';
import { MS_PER_MINUTE } from '../constants';
import { iobCalcBilinear } from './curve-bilinear';
import { iobCalcExponential } from './curve-exponential';

export function iobCalc(treatment: Treatment, time: Date | undefined, curve: InsulinCurve, dia: number, peak: number, profile: IobCalcProfile): IOBContribution | Record<string, never> {
    // iobCalc returns two variables:
    //   activityContrib = units of treatment.insulin used in previous minute
    //   iobContrib = units of treatment.insulin still remaining at a given point in time
    // ("Contrib" is used because these are the amounts contributed from pontentially multiple treatment.insulin dosages -- totals are calculated in total.js)
    //
    // Variables can be calculated using either:
    //   A bilinear insulin action curve (which only takes duration of insulin activity (dia) as an input parameter) or
    //   An exponential insulin action curve (which takes both a dia and a peak parameter)
    // (which functional form to use is specified in the user's profile)

    if (treatment.insulin) {

        // Calc minutes since bolus (minsAgo)
        if (time === undefined) {
            time = new Date();
        }
        const bolusTime = new Date(treatment.date);
        const minsAgo = Math.round((time.getTime() - bolusTime.getTime()) / MS_PER_MINUTE);


        if (curve === 'bilinear') {
            return iobCalcBilinear(treatment, minsAgo, dia);  // no user-specified peak with this model
        } else {
            return iobCalcExponential(treatment, minsAgo, dia, peak, profile);
        }

    } else { // empty return if (treatment.insulin) == False
        return {};
    }
}


export default iobCalc;
export { iobCalc as calculate };
