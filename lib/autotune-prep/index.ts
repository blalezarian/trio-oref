
// Prep step before autotune.js can run; pulls in meal (carb) data and calls categorize.js

import find_meals from '../meal/history';
import categorize from './categorize';
import type { PumpHistoryEvent, InsulinCurve } from '../types/index';
import { ULTRA_RAPID_PEAK, RAPID_ACTING_PEAK } from '../constants';

interface AutotunePrepBasalProfileEntry {
  i: number;
  start: string;
  rate: number;
  minutes: number;
}

interface AutotunePrepISFProfile {
  sensitivities: Array<{
    offset: number;
    sensitivity: number;
    endOffset: number;
  }>;
}

interface AutotunePrepProfile {
  dia: number;
  curve?: InsulinCurve;
  useCustomPeakTime?: boolean;
  insulinPeakTime?: number;
  current_basal?: number;
  basalprofile: AutotunePrepBasalProfileEntry[];
  min_5m_carbimpact: number;
  carb_ratio: number;
  sens?: number;
  isfProfile: AutotunePrepISFProfile;
  [key: string]: unknown;
}

interface AutotunePrepPumpProfile {
  basalprofile: AutotunePrepBasalProfileEntry[];
  [key: string]: unknown;
}

interface AutotunePrepInputs {
  history: PumpHistoryEvent[];
  profile: AutotunePrepProfile;
  pumpprofile: AutotunePrepPumpProfile;
  carbs: PumpHistoryEvent[];
  glucose: Array<Record<string, unknown>>;
  categorize_uam_as_basal?: boolean;
  tune_insulin_curve?: boolean;
}

interface DiaDeviation {
  dia: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface PeakDeviation {
  peak: number;
  meanDeviation: number;
  SMRDeviation: number;
  RMSDeviation: number;
}

interface AutotunePrepGlucoseDatum {
  glucose: number;
  date: number;
  dateString: string;
  displayTime?: string;
  avgDelta: string;
  BGI: number;
  deviation: string;
  mealAbsorption?: string;
  mealCarbs?: number;
}

interface AutotunePrepCRDatum {
  CRInitialIOB: number;
  CRInitialBG: number;
  CRInitialCarbTime: Date;
  CREndIOB: number;
  CREndBG: number;
  CREndTime: Date;
  CRCarbs: number;
  CRInsulin?: number;
}

interface AutotunePrepResult {
  CRData: AutotunePrepCRDatum[];
  CSFGlucoseData: AutotunePrepGlucoseDatum[];
  ISFGlucoseData: AutotunePrepGlucoseDatum[];
  basalGlucoseData: AutotunePrepGlucoseDatum[];
  diaDeviations?: DiaDeviation[];
  peakDeviations?: PeakDeviation[];
}

function generate (inputs: AutotunePrepInputs): AutotunePrepResult {

  //console.error(inputs);
  var treatments = find_meals(inputs);

  var opts: Parameters<typeof categorize>[0] = {
    treatments: treatments
  , profile: inputs.profile
  , pumpHistory: inputs.history
  , glucose: inputs.glucose
  //, prepped_glucose: inputs.prepped_glucose
  , basalprofile: inputs.profile.basalprofile
  , pumpbasalprofile: inputs.pumpprofile.basalprofile
  , categorize_uam_as_basal: inputs.categorize_uam_as_basal
  };

  var autotune_prep_output: AutotunePrepResult = categorize(opts) as unknown as AutotunePrepResult;

  if (inputs.tune_insulin_curve) {
    if (opts.profile.curve === 'bilinear') {
      console.error('--tune-insulin-curve is set but only valid for exponential curves');
    } else {
      var minDeviations = 1000000;
      var newDIA = 0;
      var diaDeviations: DiaDeviation[] = [];
      var peakDeviations: PeakDeviation[] = [];
      var currentDIA = opts.profile.dia;
      var currentPeak = opts.profile.insulinPeakTime;

      var consoleError = console.error;
      console.error = function() {};

      var startDIA=currentDIA - 2;
      var endDIA=currentDIA + 2;
      for (var dia=startDIA; dia <= endDIA; ++dia) {
        var sqrtDeviations = 0;
        var deviations = 0;
        var deviationsSq = 0;

        opts.profile.dia = dia;

        var curve_output: AutotunePrepResult = categorize(opts) as unknown as AutotunePrepResult;
        var basalGlucose = curve_output.basalGlucoseData;

        for (var hour=0; hour < 24; ++hour) {
          for (var i=0; i < basalGlucose.length; ++i) {
            var BGTime: Date | undefined;

            if (basalGlucose[i].date) {
              BGTime = new Date(basalGlucose[i].date);
            } else if (basalGlucose[i].displayTime) {
              BGTime = new Date(basalGlucose[i].displayTime!.replace('T', ' '));
            } else if (basalGlucose[i].dateString) {
              BGTime = new Date(basalGlucose[i].dateString);
            } else {
              consoleError("Could not determine last BG time");
            }

            var myHour = BGTime!.getHours();
            if (hour === myHour) {
              //console.error(basalGlucose[i].deviation);
              sqrtDeviations += Math.pow(parseFloat(String(Math.abs(Number(basalGlucose[i].deviation)))), 0.5);
              deviations += Math.abs(parseFloat(basalGlucose[i].deviation));
              deviationsSq += Math.pow(parseFloat(basalGlucose[i].deviation), 2);
            }
          }
        }

        var meanDeviation = Math.round(Math.abs(deviations/basalGlucose.length)*1000)/1000;
        var SMRDeviation = Math.round(Math.pow(sqrtDeviations/basalGlucose.length,2)*1000)/1000;
        var RMSDeviation = Math.round(Math.pow(deviationsSq/basalGlucose.length,0.5)*1000)/1000;
        consoleError('insulinEndTime', dia, 'meanDeviation:', meanDeviation, 'SMRDeviation:', SMRDeviation, 'RMSDeviation:',RMSDeviation, '(mg/dL)');
        diaDeviations.push({
            dia: dia,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotune_prep_output.diaDeviations = diaDeviations;

        deviations = Math.round(deviations*1000)/1000;
        if (deviations < minDeviations) {
          minDeviations = Math.round(deviations*1000)/1000;
          newDIA = dia;
        }
      }

      // consoleError('Optimum insulinEndTime', newDIA, 'mean deviation:', Math.round(minDeviations/basalGlucose.length*1000)/1000, '(mg/dL)');
      //consoleError(diaDeviations);

      minDeviations = 1000000;

      var newPeak = 0;
      opts.profile.dia = currentDIA;
      //consoleError(opts.profile.useCustomPeakTime, opts.profile.insulinPeakTime);
      if ( ! opts.profile.useCustomPeakTime === true && opts.profile.curve === "ultra-rapid" ) {
        opts.profile.insulinPeakTime = ULTRA_RAPID_PEAK;
      } else if ( ! opts.profile.useCustomPeakTime === true ) {
        opts.profile.insulinPeakTime = RAPID_ACTING_PEAK;
      }
      opts.profile.useCustomPeakTime = true;

      var startPeak=opts.profile.insulinPeakTime! - 10;
      var endPeak=opts.profile.insulinPeakTime! + 10;
      for (var peak=startPeak; peak <= endPeak; peak=(peak+5)) {
        sqrtDeviations = 0;
        deviations = 0;
        deviationsSq = 0;

        opts.profile.insulinPeakTime = peak;


        curve_output = categorize(opts);
        basalGlucose = curve_output.basalGlucoseData;

        for (hour=0; hour < 24; ++hour) {
          for (i=0; i < basalGlucose.length; ++i) {
            if (basalGlucose[i].date) {
              BGTime = new Date(basalGlucose[i].date);
            } else if (basalGlucose[i].displayTime) {
              BGTime = new Date(basalGlucose[i].displayTime!.replace('T', ' '));
            } else if (basalGlucose[i].dateString) {
              BGTime = new Date(basalGlucose[i].dateString);
            } else {
              consoleError("Could not determine last BG time");
            }

            myHour = BGTime!.getHours();
            if (hour === myHour) {
              //console.error(basalGlucose[i].deviation);
              sqrtDeviations += Math.pow(parseFloat(String(Math.abs(Number(basalGlucose[i].deviation)))), 0.5);
              deviations += Math.abs(parseFloat(basalGlucose[i].deviation));
              deviationsSq += Math.pow(parseFloat(basalGlucose[i].deviation), 2);
            }
          }
        }
        console.error(deviationsSq);

        meanDeviation = Math.round(deviations/basalGlucose.length*1000)/1000;
        SMRDeviation = Math.round(Math.pow(sqrtDeviations/basalGlucose.length,2)*1000)/1000;
        RMSDeviation = Math.round(Math.pow(deviationsSq/basalGlucose.length,0.5)*1000)/1000;
        consoleError('insulinPeakTime', peak, 'meanDeviation:', meanDeviation, 'SMRDeviation:', SMRDeviation, 'RMSDeviation:',RMSDeviation, '(mg/dL)');
        peakDeviations.push({
            peak: peak,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotune_prep_output.diaDeviations = diaDeviations;

        deviations = Math.round(deviations*1000)/1000;
        if (deviations < minDeviations) {
          minDeviations = Math.round(deviations*1000)/1000;
          newPeak = peak;
        }
      }

      //consoleError('Optimum insulinPeakTime', newPeak, 'mean deviation:', Math.round(minDeviations/basalGlucose.length*1000)/1000, '(mg/dL)');
      //consoleError(peakDeviations);
      autotune_prep_output.peakDeviations = peakDeviations;

      console.error = consoleError;
    }
  }

  return autotune_prep_output;
}

export default generate;
