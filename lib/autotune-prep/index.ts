
// Prep step before autotune.js can run; pulls in meal (carb) data and calls categorize.js

import find_meals from '../meal/history';
import categorize from './categorize';
import type { PumpHistoryEvent, InsulinCurve } from '../types/index';
import { ULTRA_RAPID_PEAK, RAPID_ACTING_PEAK, HOURS_PER_DAY } from '../constants';

/** Sentinel value for minimum-deviations search initialization */
const DEVIATION_SENTINEL = 1000000;
/** DIA search range: ±N hours around current DIA */
const DIA_SEARCH_RANGE = 2;
/** Peak time search range: ±N minutes around current peak */
const PEAK_SEARCH_RANGE = 10;
/** Peak time search step size (minutes) */
const PEAK_SEARCH_STEP = 5;
/** Rounding scale for 3 decimal places */
const ROUND_SCALE_3DP = 1000;

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
      var minDeviations = DEVIATION_SENTINEL;
      var newDIA = 0;
      var diaDeviations: DiaDeviation[] = [];
      var peakDeviations: PeakDeviation[] = [];
      var currentDIA = opts.profile.dia;
      var currentPeak = opts.profile.insulinPeakTime;

      var consoleError = console.error;
      console.error = function() {};

      var startDIA=currentDIA - DIA_SEARCH_RANGE;
      var endDIA=currentDIA + DIA_SEARCH_RANGE;
      for (var dia=startDIA; dia <= endDIA; ++dia) {
        var sqrtDeviations = 0;
        var deviations = 0;
        var deviationsSq = 0;

        opts.profile.dia = dia;

        var curve_output: AutotunePrepResult = categorize(opts) as unknown as AutotunePrepResult;
        var basalGlucose = curve_output.basalGlucoseData;

        for (var hour=0; hour < HOURS_PER_DAY; ++hour) {
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

        var meanDeviation = Math.round(Math.abs(deviations/basalGlucose.length)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        var SMRDeviation = Math.round(Math.pow(sqrtDeviations/basalGlucose.length,2)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        var RMSDeviation = Math.round(Math.pow(deviationsSq/basalGlucose.length,0.5)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        consoleError('insulinEndTime', dia, 'meanDeviation:', meanDeviation, 'SMRDeviation:', SMRDeviation, 'RMSDeviation:',RMSDeviation, '(mg/dL)');
        diaDeviations.push({
            dia: dia,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotune_prep_output.diaDeviations = diaDeviations;

        deviations = Math.round(deviations*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        if (deviations < minDeviations) {
          minDeviations = Math.round(deviations*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
          newDIA = dia;
        }
      }

      // consoleError('Optimum insulinEndTime', newDIA, 'mean deviation:', Math.round(minDeviations/basalGlucose.length*ROUND_SCALE_3DP)/ROUND_SCALE_3DP, '(mg/dL)');
      //consoleError(diaDeviations);

      minDeviations = DEVIATION_SENTINEL;

      var newPeak = 0;
      opts.profile.dia = currentDIA;
      //consoleError(opts.profile.useCustomPeakTime, opts.profile.insulinPeakTime);
      if ( ! opts.profile.useCustomPeakTime === true && opts.profile.curve === "ultra-rapid" ) {
        opts.profile.insulinPeakTime = ULTRA_RAPID_PEAK;
      } else if ( ! opts.profile.useCustomPeakTime === true ) {
        opts.profile.insulinPeakTime = RAPID_ACTING_PEAK;
      }
      opts.profile.useCustomPeakTime = true;

      var startPeak=opts.profile.insulinPeakTime! - PEAK_SEARCH_RANGE;
      var endPeak=opts.profile.insulinPeakTime! + PEAK_SEARCH_RANGE;
      for (var peak=startPeak; peak <= endPeak; peak=(peak+PEAK_SEARCH_STEP)) {
        sqrtDeviations = 0;
        deviations = 0;
        deviationsSq = 0;

        opts.profile.insulinPeakTime = peak;


        curve_output = categorize(opts);
        basalGlucose = curve_output.basalGlucoseData;

        for (hour=0; hour < HOURS_PER_DAY; ++hour) {
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

        meanDeviation = Math.round(deviations/basalGlucose.length*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        SMRDeviation = Math.round(Math.pow(sqrtDeviations/basalGlucose.length,2)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        RMSDeviation = Math.round(Math.pow(deviationsSq/basalGlucose.length,0.5)*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        consoleError('insulinPeakTime', peak, 'meanDeviation:', meanDeviation, 'SMRDeviation:', SMRDeviation, 'RMSDeviation:',RMSDeviation, '(mg/dL)');
        peakDeviations.push({
            peak: peak,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotune_prep_output.diaDeviations = diaDeviations;

        deviations = Math.round(deviations*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
        if (deviations < minDeviations) {
          minDeviations = Math.round(deviations*ROUND_SCALE_3DP)/ROUND_SCALE_3DP;
          newPeak = peak;
        }
      }

      //consoleError('Optimum insulinPeakTime', newPeak, 'mean deviation:', Math.round(minDeviations/basalGlucose.length*ROUND_SCALE_3DP)/ROUND_SCALE_3DP, '(mg/dL)');
      //consoleError(peakDeviations);
      autotune_prep_output.peakDeviations = peakDeviations;

      console.error = consoleError;
    }
  }

  return autotune_prep_output;
}

export default generate;
