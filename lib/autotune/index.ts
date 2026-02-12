import percentile from '../percentile';
import type { InsulinCurve } from '../types/index';
import {
    ULTRA_RAPID_PEAK,
    RAPID_ACTING_PEAK,
    MAX_DIA_HOURS,
    AUTOTUNE_IMPROVEMENT_THRESHOLD,
    AUTOTUNE_ADJUSTMENT_FRACTION,
    DEFAULT_AUTOSENS_MAX,
    DEFAULT_AUTOSENS_MIN,
    MAX_CARB_RATIO,
    MIN_CARB_RATIO,
    BASAL_SCALE_DEFAULT,
} from '../constants';
//rounding of basals for pumps
//20 for omnipod to 0.05
//40 for medtronic to 0.025
const basal_scale: number = BASAL_SCALE_DEFAULT;
// does three things - tunes basals, ISF, and CSF

interface AutotuneBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
  untuned?: number;
}

interface AutotuneISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface AutotunePreviousProfile {
  basalprofile: AutotuneBasalProfileEntry[];
  isfProfile: AutotuneISFProfile;
  sens?: number;
  carb_ratio: number;
  csf?: number;
  dia: number;
  curve?: Exclude<InsulinCurve, 'bilinear'>;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  min_5m_carbimpact?: number;
  [key: string]: unknown;
}

interface AutotunePumpProfile {
  basalprofile: AutotuneBasalProfileEntry[];
  isfProfile?: AutotuneISFProfile;
  carb_ratio?: number;
  autosens_min?: number;
  autosens_max?: number;
  autotune_isf_adjustmentFraction?: number;
  [key: string]: unknown;
}

interface AutotuneGlucoseDatum {
  glucose?: number;
  date?: number;
  displayTime?: string;
  dateString?: string;
  deviation: string;
  BGI: number;
  avgDelta: string;
  mealAbsorption?: string;
  mealCarbs?: number;
}

interface AutotuneCRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin: number;
  CRInsulinTotal?: number;
}

interface AutotuneDiaDeviation {
  dia: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePeakDeviation {
  peak: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePreppedGlucose {
  CRData: AutotuneCRDatum[];
  CSFGlucoseData: AutotuneGlucoseDatum[];
  ISFGlucoseData: AutotuneGlucoseDatum[];
  basalGlucoseData: AutotuneGlucoseDatum[];
  diaDeviations?: AutotuneDiaDeviation[];
  peakDeviations?: AutotunePeakDeviation[];
}

interface AutotuneInputs {
  previousAutotune: AutotunePreviousProfile;
  pumpProfile: AutotunePumpProfile;
  preppedGlucose: AutotunePreppedGlucose;
}

function tuneAllTheThings (inputs: AutotuneInputs): AutotunePreviousProfile | undefined {

    const previousAutotune = inputs.previousAutotune;
    //console.error(previousAutotune);
    const pumpProfile = inputs.pumpProfile;
    const pumpBasalProfile = pumpProfile.basalprofile;
    //console.error(pumpBasalProfile);
    let basalProfile = previousAutotune.basalprofile;
    //console.error(basalProfile);
    const isfProfile = previousAutotune.isfProfile;
    //console.error(isfProfile);
    let ISF = isfProfile.sensitivities[0].sensitivity;
    //console.error(ISF);
    let carbRatio = previousAutotune.carb_ratio;
    //console.error(carbRatio);
    let CSF = ISF / carbRatio;
    const DIA = previousAutotune.dia;
    let peak = previousAutotune.insulinPeakTime;
    if (! previousAutotune.useCustomPeakTime === true) {
        if ( previousAutotune.curve === "ultra-rapid" ) {
            peak = ULTRA_RAPID_PEAK;
        } else {
            peak = RAPID_ACTING_PEAK;
        }
    }
    //console.error(DIA, peak);

    // conditional on there being a pump profile; if not then skip
    let pumpISFProfile: AutotuneISFProfile | undefined;
    if (pumpProfile) { pumpISFProfile = pumpProfile.isfProfile; }
    let pumpISF: number | undefined;
    let pumpCarbRatio: number | undefined;
    let pumpCSF: number | undefined;
    if (pumpISFProfile && pumpISFProfile.sensitivities[0]) {
        pumpISF = pumpISFProfile.sensitivities[0].sensitivity;
        pumpCarbRatio = pumpProfile.carb_ratio;
        pumpCSF = pumpISF / pumpCarbRatio!;
    }
    if (! carbRatio) { carbRatio = pumpCarbRatio!; }
    if (! CSF) { CSF = pumpCSF!; }
    if (! ISF) { ISF = pumpISF!; }
    //console.error(CSF);
    const preppedGlucose = inputs.preppedGlucose;
    const CSFGlucose = preppedGlucose.CSFGlucoseData;
    //console.error(CSFGlucose[0]);
    const ISFGlucose = preppedGlucose.ISFGlucoseData;
    //console.error(ISFGlucose[0]);
    const basalGlucose = preppedGlucose.basalGlucoseData;
    //console.error(basalGlucose[0]);
    const CRData = preppedGlucose.CRData;
    //console.error(CRData);
    const diaDeviations = preppedGlucose.diaDeviations;
    //console.error(diaDeviations);
    const peakDeviations = preppedGlucose.peakDeviations;
    //console.error(peakDeviations);

    // tune DIA
    let newDIA = DIA;
    // variables shared across multiple for-loops (were function-scoped with var)
    let i: number;
    let minMeanDeviations: number;
    let minRMSDeviations: number;
    let meanBest: number;
    let RMSBest: number;
    let meanDeviations: number;
    let RMSDeviations: number;
    if (diaDeviations) {
        const currentDIAMeanDev = diaDeviations[2].meanDeviation;
        const currentDIARMSDev = diaDeviations[2].RMSDeviation;
        //console.error(DIA,currentDIAMeanDev,currentDIARMSDev);
        minMeanDeviations = 1000000;
        minRMSDeviations = 1000000;
        meanBest = 2;
        RMSBest = 2;
        for (i=0; i < diaDeviations.length; i++) {
            meanDeviations = diaDeviations[i].meanDeviation;
            RMSDeviations = diaDeviations[i].RMSDeviation;
            if (meanDeviations < minMeanDeviations) {
                minMeanDeviations = Math.round(meanDeviations*1000)/1000;
                meanBest = i;
            }
            if (RMSDeviations < minRMSDeviations) {
                minRMSDeviations = Math.round(RMSDeviations*1000)/1000;
                RMSBest = i;
            }
        }
        console.error("Best insulinEndTime for meanDeviations:",diaDeviations[meanBest].dia,"hours");
        console.error("Best insulinEndTime for RMSDeviations:",diaDeviations[RMSBest].dia,"hours");
        if ( meanBest < 2 && RMSBest < 2 ) {
            if ( diaDeviations[1].meanDeviation < currentDIAMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD && diaDeviations[1].RMSDeviation < currentDIARMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD ) {
                newDIA = diaDeviations[1].dia;
            }
        } else if ( meanBest > 2 && RMSBest > 2 ) {
            if ( diaDeviations[3].meanDeviation < currentDIAMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD && diaDeviations[3].RMSDeviation < currentDIARMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD ) {
                newDIA = diaDeviations[3].dia;
            }
        }
        if ( newDIA > MAX_DIA_HOURS ) {
            console.error("insulinEndTime maximum is 12h: not raising further");
            newDIA=MAX_DIA_HOURS;
        }
        if ( newDIA !== DIA ) {
            console.error("Adjusting insulinEndTime from",DIA,"to",newDIA,"hours");
        } else {
            console.error("Leaving insulinEndTime unchanged at",DIA,"hours");
        }
    }

    // tune insulinPeakTime
    let newPeak = peak;
    if (peakDeviations && peakDeviations[2]) {
        const currentPeakMeanDev = peakDeviations[2].meanDeviation;
        const currentPeakRMSDev = peakDeviations[2].RMSDeviation;
        //console.error(currentPeakMeanDev);
        minMeanDeviations = 1000000;
        minRMSDeviations = 1000000;
        meanBest = 2;
        RMSBest = 2;
        for (i=0; i < peakDeviations.length; i++) {
            meanDeviations = peakDeviations[i].meanDeviation;
            RMSDeviations = peakDeviations[i].RMSDeviation;
            if (meanDeviations < minMeanDeviations) {
                minMeanDeviations = Math.round(meanDeviations*1000)/1000;
                meanBest = i;
            }
            if (RMSDeviations < minRMSDeviations) {
                minRMSDeviations = Math.round(RMSDeviations*1000)/1000;
                RMSBest = i;
            }
        }
        console.error("Best insulinPeakTime for meanDeviations:",peakDeviations[meanBest].peak,"minutes");
        console.error("Best insulinPeakTime for RMSDeviations:",peakDeviations[RMSBest].peak,"minutes");
        if ( meanBest < 2 && RMSBest < 2 ) {
            if ( peakDeviations[1].meanDeviation < currentPeakMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD && peakDeviations[1].RMSDeviation < currentPeakRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD ) {
                newPeak = peakDeviations[1].peak;
            }
        } else if ( meanBest > 2 && RMSBest > 2 ) {
            if ( peakDeviations[3].meanDeviation < currentPeakMeanDev * AUTOTUNE_IMPROVEMENT_THRESHOLD && peakDeviations[3].RMSDeviation < currentPeakRMSDev * AUTOTUNE_IMPROVEMENT_THRESHOLD ) {
                newPeak = peakDeviations[3].peak;
            }
        }
        if ( newPeak !== peak ) {
            console.error("Adjusting insulinPeakTime from",peak,"to",newPeak,"minutes");
        } else {
            console.error("Leaving insulinPeakTime unchanged at",peak);
        }
    }



    // Calculate carb ratio (CR) independently of CSF and ISF
    // Use the time period from meal bolus/carbs until COB is zero and IOB is < currentBasal/2
    // For now, if another meal IOB/COB stacks on top of it, consider them together
    // Compare beginning and ending BGs, and calculate how much more/less insulin is needed to neutralize
    // Use entered carbs vs. starting IOB + delivered insulin + needed-at-end insulin to directly calculate CR.

    let CRTotalCarbs = 0;
    let CRTotalInsulin = 0;
    CRData.forEach((CRDatum: AutotuneCRDatum) => {
        const CRBGChange = CRDatum.CREndBG - CRDatum.CRInitialBG;
        const CRInsulinReq = CRBGChange / ISF;
        const CRIOBChange = CRDatum.CREndIOB - CRDatum.CRInitialIOB;
        CRDatum.CRInsulinTotal = CRDatum.CRInitialIOB + CRDatum.CRInsulin + CRInsulinReq;
        //console.error(CRDatum.CRInitialIOB, CRDatum.CRInsulin, CRInsulinReq, CRDatum.CRInsulinTotal);
        const CR = Math.round( CRDatum.CRCarbs / CRDatum.CRInsulinTotal * 1000 )/1000;
        //console.error(CRBGChange, CRInsulinReq, CRIOBChange, CRDatum.CRInsulinTotal);
        //console.error("CRCarbs:",CRDatum.CRCarbs,"CRInsulin:",CRDatum.CRInsulin,"CRDatum.CRInsulinTotal:",CRDatum.CRInsulinTotal,"CR:",CR);
        if (CRDatum.CRInsulinTotal > 0) {
            CRTotalCarbs += CRDatum.CRCarbs;
            CRTotalInsulin += CRDatum.CRInsulinTotal;
            //console.error("CRTotalCarbs:",CRTotalCarbs,"CRTotalInsulin:",CRTotalInsulin);
        }
    });
    CRTotalInsulin = Math.round(CRTotalInsulin*1000)/1000;
    const totalCR = Math.round( CRTotalCarbs / CRTotalInsulin * 1000 )/1000;
    console.error("CRTotalCarbs:",CRTotalCarbs,"CRTotalInsulin:",CRTotalInsulin,"totalCR:",totalCR);

    // convert the basal profile to hourly if it isn't already
    const hourlyBasalProfile: AutotuneBasalProfileEntry[] = [];
    const hourlyPumpProfile: AutotuneBasalProfileEntry[] = [];
    for (i=0; i < 24; i++) {
        // autotuned basal profile
        for (let j=0; j < basalProfile.length; ++j) {
            if (basalProfile[j].minutes <= i * 60) {
                if (basalProfile[j].rate === 0) {
                    console.error("ERROR: bad basalProfile",basalProfile[j]);
                    return;
                }
                hourlyBasalProfile[i] = JSON.parse(JSON.stringify(basalProfile[j]));
            }
        }
        hourlyBasalProfile[i].i=i;
        hourlyBasalProfile[i].minutes=i*60;
        const zeroPadHour = ("000"+i).slice(-2);
        hourlyBasalProfile[i].start=zeroPadHour + ":00:00";
        hourlyBasalProfile[i].rate=Math.round(hourlyBasalProfile[i].rate*1000)/1000
        // pump basal profile
        if (pumpBasalProfile && pumpBasalProfile[0]) {
            for (let j=0; j < pumpBasalProfile.length; ++j) {
                //console.error(pumpBasalProfile[j]);
                if (pumpBasalProfile[j].rate === 0) {
                    console.error("ERROR: bad pumpBasalProfile",pumpBasalProfile[j]);
                    return;
                }
                if (pumpBasalProfile[j].minutes <= i * 60) {
                    hourlyPumpProfile[i] = JSON.parse(JSON.stringify(pumpBasalProfile[j]));
                }
            }
            hourlyPumpProfile[i].i=i;
            hourlyPumpProfile[i].minutes=i*60;
            hourlyPumpProfile[i].rate=Math.round(hourlyPumpProfile[i].rate*1000)/1000
        }
    }
    //console.error(hourlyPumpProfile);
    //console.error(hourlyBasalProfile);
    const newHourlyBasalProfile: AutotuneBasalProfileEntry[] = JSON.parse(JSON.stringify(hourlyBasalProfile));

    // look at net deviations for each hour
    let autotuneMax: number;
    let autotuneMin: number;
    // variables shared across hour loops (were function-scoped with var)
    let hour: number;
    let BGTime: Date | undefined;
    let myHour: number;
    for (hour=0; hour < 24; hour++) {
        let deviations: number = 0;
        for (i=0; i < basalGlucose.length; ++i) {

            if (basalGlucose[i].date) {
                BGTime = new Date(basalGlucose[i].date!);
            } else if (basalGlucose[i].displayTime) {
                BGTime = new Date(basalGlucose[i].displayTime!.replace('T', ' '));
            } else if (basalGlucose[i].dateString) {
                BGTime = new Date(basalGlucose[i].dateString!);
            } else {
                console.error("Could not determine last BG time");
            }

            myHour = BGTime!.getHours();
            if (hour === myHour) {
                //console.error(basalGlucose[i].deviation);
                deviations += parseFloat(basalGlucose[i].deviation);
            }
        }
        deviations = Math.round( deviations * 1000 ) / 1000
        console.error("Hour",hour.toString(),"total deviations:",deviations,"mg/dL");
        // calculate how much less or additional basal insulin would have been required to eliminate the deviations
        // only apply 20% of the needed adjustment to keep things relatively stable
        let basalNeeded = AUTOTUNE_ADJUSTMENT_FRACTION * deviations / ISF;
        basalNeeded = Math.round( basalNeeded * 100 ) / 100
        // if basalNeeded is positive, adjust each of the 1-3 hour prior basals by 10% of the needed adjustment
        console.error("Hour",hour,"basal adjustment needed:",basalNeeded,"U/hr");
        if (basalNeeded > 0 ) {
            for (let offset=-3; offset < 0; offset++) {
                let offsetHour = hour + offset;
                if (offsetHour < 0) { offsetHour += 24; }
                //console.error(offsetHour);
                newHourlyBasalProfile[offsetHour].rate += basalNeeded / 3;
                newHourlyBasalProfile[offsetHour].rate=Math.round(newHourlyBasalProfile[offsetHour].rate*1000)/1000
            }
        // otherwise, figure out the percentage reduction required to the 1-3 hour prior basals
        // and adjust all of them downward proportionally
        } else if (basalNeeded < 0) {
            let threeHourBasal = 0;
            for (let offset=-3; offset < 0; offset++) {
                let offsetHour = hour + offset;
                if (offsetHour < 0) { offsetHour += 24; }
                threeHourBasal += newHourlyBasalProfile[offsetHour].rate;
            }
            const adjustmentRatio = 1.0 + basalNeeded / threeHourBasal;
            //console.error(adjustmentRatio);
            for (let offset=-3; offset < 0; offset++) {
                let offsetHour = hour + offset;
                if (offsetHour < 0) { offsetHour += 24; }
                newHourlyBasalProfile[offsetHour].rate = newHourlyBasalProfile[offsetHour].rate * adjustmentRatio;
                newHourlyBasalProfile[offsetHour].rate=Math.round(newHourlyBasalProfile[offsetHour].rate*1000)/1000
            }
        }
    }
    if (pumpBasalProfile && pumpBasalProfile[0]) {
        for (hour=0; hour < 24; hour++) {
            //console.error(newHourlyBasalProfile[hour],hourlyPumpProfile[hour].rate*1.2);
            // cap adjustments at autosens_max and autosens_min
            if (pumpProfile.autosens_max !== undefined) {
                autotuneMax = pumpProfile.autosens_max;
            } else {
                autotuneMax = DEFAULT_AUTOSENS_MAX;
            }
            if (pumpProfile.autosens_min !== undefined) {
                autotuneMin = pumpProfile.autosens_min;
            } else {
                autotuneMin = DEFAULT_AUTOSENS_MIN;
            }
            const maxRate = hourlyPumpProfile[hour].rate * autotuneMax;
            const minRate = hourlyPumpProfile[hour].rate * autotuneMin;
            if (newHourlyBasalProfile[hour].rate > maxRate ) {
                console.error("Limiting hour",hour,"basal to",maxRate.toFixed(2),"(which is",autotuneMax,"* pump basal of",hourlyPumpProfile[hour].rate,")");
                //console.error("Limiting hour",hour,"basal to",maxRate.toFixed(2),"(which is 20% above pump basal of",hourlyPumpProfile[hour].rate,")");
                newHourlyBasalProfile[hour].rate = maxRate;
            } else if (newHourlyBasalProfile[hour].rate < minRate ) {
                console.error("Limiting hour",hour,"basal to",minRate.toFixed(2),"(which is",autotuneMin,"* pump basal of",hourlyPumpProfile[hour].rate,")");
                //console.error("Limiting hour",hour,"basal to",minRate.toFixed(2),"(which is 20% below pump basal of",hourlyPumpProfile[hour].rate,")");
                newHourlyBasalProfile[hour].rate = minRate;
            }
            newHourlyBasalProfile[hour].rate = Math.round(newHourlyBasalProfile[hour].rate*basal_scale)/basal_scale;
        }
    }

    // some hours of the day rarely have data to tune basals due to meals.
    // when no adjustments are needed to a particular hour, we should adjust it toward the average of the
    // periods before and after it that do have data to be tuned

    let lastAdjustedHour = 0;
    // scan through newHourlyBasalProfile and find hours where the rate is unchanged
    for (hour=0; hour < 24; hour++) {
        if (hourlyBasalProfile[hour].rate === newHourlyBasalProfile[hour].rate) {
            let nextAdjustedHour = 23;
            for (let nextHour = hour; nextHour < 24; nextHour++) {
                if (! (hourlyBasalProfile[nextHour].rate === newHourlyBasalProfile[nextHour].rate)) {
                    nextAdjustedHour = nextHour;
                    break;
                //} else {
                    //console.error(nextHour, hourlyBasalProfile[nextHour].rate, newHourlyBasalProfile[nextHour].rate);
                }
            }
            //console.error(hour, newHourlyBasalProfile);
            newHourlyBasalProfile[hour].rate = Math.round( (0.8*hourlyBasalProfile[hour].rate + 0.1*newHourlyBasalProfile[lastAdjustedHour].rate + 0.1*newHourlyBasalProfile[nextAdjustedHour].rate)*basal_scale)/basal_scale;
			if (newHourlyBasalProfile[hour].untuned)
				newHourlyBasalProfile[hour].untuned!++;
			else
				newHourlyBasalProfile[hour].untuned = 1;
            console.error("Adjusting hour",hour,"basal from",hourlyBasalProfile[hour].rate,"to",newHourlyBasalProfile[hour].rate,"based on hour",lastAdjustedHour,"=",newHourlyBasalProfile[lastAdjustedHour].rate,"and hour",nextAdjustedHour,"=",newHourlyBasalProfile[nextAdjustedHour].rate);
        } else {
            lastAdjustedHour = hour;
        }
    }

    console.error(newHourlyBasalProfile);
    basalProfile = newHourlyBasalProfile;

    // Calculate carb ratio (CR) independently of CSF and ISF
    // Use the time period from meal bolus/carbs until COB is zero and IOB is < currentBasal/2
    // For now, if another meal IOB/COB stacks on top of it, consider them together
    // Compare beginning and ending BGs, and calculate how much more/less insulin is needed to neutralize
    // Use entered carbs vs. starting IOB + delivered insulin + needed-at-end insulin to directly calculate CR.



    // calculate net deviations while carbs are absorbing
    // measured from carb entry until COB and deviations both drop to zero

    let deviations: number | number[] = 0;
    let mealCarbs = 0;
    let totalMealCarbs = 0;
    let totalDeviations = 0;
    let fullNewCSF: number;
    //console.error(CSFGlucose[0].mealAbsorption);
    //console.error(CSFGlucose[0]);
    for (i=0; i < CSFGlucose.length; ++i) {
        //console.error(CSFGlucose[i].mealAbsorption, i);
        if ( CSFGlucose[i].mealAbsorption === "start" ) {
            deviations = 0;
            mealCarbs = parseInt(String(CSFGlucose[i].mealCarbs));
        } else if (CSFGlucose[i].mealAbsorption === "end") {
            deviations += parseFloat(CSFGlucose[i].deviation);
            // compare the sum of deviations from start to end vs. current CSF * mealCarbs
            //console.error(CSF,mealCarbs);
            const csfRise = CSF * mealCarbs;
            //console.error(deviations,ISF);
            //console.error("csfRise:",csfRise,"deviations:",deviations);
            totalMealCarbs += mealCarbs;
            totalDeviations += deviations;

        } else {
            deviations += Math.max(0*previousAutotune.min_5m_carbimpact!,parseFloat(CSFGlucose[i].deviation));
            mealCarbs = Math.max(mealCarbs, parseInt(String(CSFGlucose[i].mealCarbs)));
        }
    }
    // at midnight, write down the mealcarbs as total meal carbs (to prevent special case of when only one meal and it not finishing absorbing by midnight)
    // TODO: figure out what to do with dinner carbs that don't finish absorbing by midnight
    if (totalMealCarbs === 0) { totalMealCarbs += mealCarbs; }
    if (totalDeviations === 0) { totalDeviations += deviations; }
    //console.error(totalDeviations, totalMealCarbs);
    if (totalMealCarbs === 0) {
        // if no meals today, CSF is unchanged
        fullNewCSF = CSF;
    } else {
        // how much change would be required to account for all of the deviations
        fullNewCSF = Math.round( (totalDeviations / totalMealCarbs)*100 )/100;
    }
    // only adjust by 20%
    let newCSF = ( (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * CSF ) + ( AUTOTUNE_ADJUSTMENT_FRACTION * fullNewCSF );
    // safety cap CSF
    if (pumpCSF !== undefined) {
        const maxCSF = pumpCSF * autotuneMax!;
        const minCSF = pumpCSF * autotuneMin!;
        if (newCSF > maxCSF) {
            console.error("Limiting CSF to",maxCSF.toFixed(2),"(which is",autotuneMax!,"* pump CSF of",pumpCSF,")");
            newCSF = maxCSF;
        } else if (newCSF < minCSF) {
            console.error("Limiting CSF to",minCSF.toFixed(2),"(which is",autotuneMin!,"* pump CSF of",pumpCSF,")");
            newCSF = minCSF;
        } //else { console.error("newCSF",newCSF,"is close enough to",pumpCSF); }
    }
    const oldCSF = Math.round( CSF * 1000 ) / 1000;
    newCSF = Math.round( newCSF * 1000 ) / 1000;
    totalDeviations = Math.round ( totalDeviations * 1000 )/1000;
    console.error("totalMealCarbs:",totalMealCarbs,"totalDeviations:",totalDeviations,"oldCSF",oldCSF,"fullNewCSF:",fullNewCSF,"newCSF:",newCSF);
    // this is where CSF is set based on the outputs
    if (newCSF) {
        CSF = newCSF;
    }

    let fullNewCR: number;
    if (totalCR === 0) {
        // if no meals today, CR is unchanged
        fullNewCR = carbRatio;
    } else {
        // how much change would be required to account for all of the deviations
        fullNewCR = totalCR;
    }
    // don't tune CR out of bounds
    let maxCR = pumpCarbRatio! * autotuneMax!;
    if (maxCR > MAX_CARB_RATIO) { maxCR = MAX_CARB_RATIO }
    let minCR = pumpCarbRatio! * autotuneMin!;
    if (minCR < MIN_CARB_RATIO) { minCR = MIN_CARB_RATIO }
    // safety cap fullNewCR
    if (pumpCarbRatio !== undefined) {
        if (fullNewCR > maxCR) {
            console.error("Limiting fullNewCR from",fullNewCR,"to",maxCR.toFixed(2),"(which is",autotuneMax!,"* pump CR of",pumpCarbRatio,")");
            fullNewCR = maxCR;
        } else if (fullNewCR < minCR) {
            console.error("Limiting fullNewCR from",fullNewCR,"to",minCR.toFixed(2),"(which is",autotuneMin!,"* pump CR of",pumpCarbRatio,")");
            fullNewCR = minCR;
        } //else { console.error("newCR",newCR,"is close enough to",pumpCarbRatio); }
    }
    // only adjust by 20%
    let newCR = ( (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * carbRatio ) + ( AUTOTUNE_ADJUSTMENT_FRACTION * fullNewCR );
    // safety cap newCR
    if (pumpCarbRatio !== undefined) {
        if (newCR > maxCR) {
            console.error("Limiting CR to",maxCR.toFixed(2),"(which is",autotuneMax!,"* pump CR of",pumpCarbRatio,")");
            newCR = maxCR;
        } else if (newCR < minCR) {
            console.error("Limiting CR to",minCR.toFixed(2),"(which is",autotuneMin!,"* pump CR of",pumpCarbRatio,")");
            newCR = minCR;
        } //else { console.error("newCR",newCR,"is close enough to",pumpCarbRatio); }
    }
    newCR = Math.round( newCR * 1000 ) / 1000;
    console.error("oldCR:",carbRatio,"fullNewCR:",fullNewCR,"newCR:",newCR);
    // this is where CR is set based on the outputs
    //var ISFFromCRAndCSF = ISF;
    if (newCR) {
        carbRatio = newCR;
        //ISFFromCRAndCSF = Math.round( carbRatio * CSF * 1000)/1000;
    }



    // calculate median deviation and bgi in data attributable to ISF
    deviations = [];
    const BGIs: number[] = [];
    const avgDeltas: number[] = [];
    const ratios: number[] = [];
    let deviation: number;
    for (i=0; i < ISFGlucose.length; ++i) {
        deviation = parseFloat(ISFGlucose[i].deviation);
        deviations.push(deviation);
        const BGI = parseFloat(String(ISFGlucose[i].BGI));
        BGIs.push(BGI);
        const avgDelta = parseFloat(ISFGlucose[i].avgDelta);
        avgDeltas.push(avgDelta);
        const ratio = 1 + deviation / BGI;
        //console.error("Deviation:",deviation,"BGI:",BGI,"avgDelta:",avgDelta,"ratio:",ratio);
        ratios.push(ratio);
    }
    avgDeltas.sort((a: number, b: number) => a-b);
    BGIs.sort((a: number, b: number) => a-b);
    deviations.sort((a: number, b: number) => a-b);
    ratios.sort((a: number, b: number) => a-b);
    let p50deviation = percentile(deviations, 0.50);
    let p50BGI = percentile(BGIs, 0.50);
    const p50ratios = Math.round( percentile(ratios, 0.50) * 1000)/1000;
    let fullNewISF = ISF;
    if (ISFGlucose.length < 10) {
        // leave ISF unchanged if fewer than 10 ISF data points
        console.error ("Only found",ISFGlucose.length,"ISF data points, leaving ISF unchanged at",ISF);
    } else {
        // calculate what adjustments to ISF would have been necessary to bring median deviation to zero
        fullNewISF = ISF * p50ratios;
    }
    fullNewISF = Math.round( fullNewISF * 1000 ) / 1000;
    //console.error("p50ratios:",p50ratios,"fullNewISF:",fullNewISF,ratios[Math.floor(ratios.length/2)]);
    // adjust the target ISF to be a weighted average of fullNewISF and pumpISF
    let adjustmentFraction: number;

    if (pumpProfile.autotune_isf_adjustmentFraction !== undefined) {
        adjustmentFraction = pumpProfile.autotune_isf_adjustmentFraction;
    } else {
        adjustmentFraction = 1.0;
    }

    // low autosens ratio = high ISF
    const maxISF = pumpISF! / autotuneMin!;
    // high autosens ratio = low ISF
    const minISF = pumpISF! / autotuneMax!;
    let adjustedISF: number;
    let newISF: number;
    if (pumpISF !== undefined) {
        if ( fullNewISF < 0 ) {
            adjustedISF = ISF;
        } else {
            adjustedISF = adjustmentFraction*fullNewISF + (1-adjustmentFraction)*pumpISF;
        }
        // cap adjustedISF before applying 10%
        //console.error(adjustedISF, maxISF, minISF);
        if (adjustedISF > maxISF) {
            console.error("Limiting adjusted ISF of",adjustedISF.toFixed(2),"to",maxISF.toFixed(2),"(which is pump ISF of",pumpISF,"/",autotuneMin!,")");
            adjustedISF = maxISF;
        } else if (adjustedISF < minISF) {
            console.error("Limiting adjusted ISF of",adjustedISF.toFixed(2),"to",minISF.toFixed(2),"(which is pump ISF of",pumpISF,"/",autotuneMax!,")");
            adjustedISF = minISF;
        }

        // and apply 20% of that adjustment
        newISF = ( (1 - AUTOTUNE_ADJUSTMENT_FRACTION) * ISF ) + ( AUTOTUNE_ADJUSTMENT_FRACTION * adjustedISF );

        if (newISF > maxISF) {
            console.error("Limiting ISF of",newISF.toFixed(2),"to",maxISF.toFixed(2),"(which is pump ISF of",pumpISF,"/",autotuneMin!,")");
            newISF = maxISF;
        } else if (newISF < minISF) {
            console.error("Limiting ISF of",newISF.toFixed(2),"to",minISF.toFixed(2),"(which is pump ISF of",pumpISF,"/",autotuneMax!,")");
            newISF = minISF;
        }
    }
    newISF = Math.round( newISF! * 1000 ) / 1000;
    //console.error(avgRatio);
    //console.error(newISF);
    p50deviation = Math.round( p50deviation * 1000 ) / 1000;
    p50BGI = Math.round( p50BGI * 1000 ) / 1000;
    adjustedISF = Math.round( adjustedISF! * 1000 ) / 1000;
    console.error("p50deviation:",p50deviation,"p50BGI",p50BGI,"p50ratios:",p50ratios,"Old ISF:",ISF,"fullNewISF:",fullNewISF,"adjustedISF:",adjustedISF,"newISF:",newISF,"newDIA:",newDIA,"newPeak:",newPeak);

    if (newISF) {
        ISF = newISF;
    }


    // reconstruct updated version of previousAutotune as autotuneOutput
    const autotuneOutput = previousAutotune;
    autotuneOutput.basalprofile = basalProfile;
    isfProfile.sensitivities[0].sensitivity = ISF;
    autotuneOutput.isfProfile = isfProfile;
    autotuneOutput.sens = ISF;
    autotuneOutput.csf = CSF;
    //carbRatio = ISF / CSF;
    carbRatio = Math.round( carbRatio * 1000 ) / 1000;
    autotuneOutput.carb_ratio = carbRatio;
    autotuneOutput.dia = newDIA;
    autotuneOutput.insulinPeakTime = newPeak;
    if (diaDeviations || peakDeviations) {
        autotuneOutput.useCustomPeakTime = true;
    }

    return autotuneOutput;
}

export default tuneAllTheThings;
