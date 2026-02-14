// NOTE: This module is not used by the current version of Trio.
// Prep step before autotune.js can run; pulls in meal (carb) data and calls categorize.js

import { findMealInputs as findMeals } from '../meal/history';
import { categorizeBGDatums as categorize } from './categorize';
import type { CategorizeResult, CategorizeGlucoseDatum } from './categorize';
import type { PumpHistoryEvent, InsulinCurve } from '../types/index';
import { ULTRA_RAPID_PEAK, RAPID_ACTING_PEAK, HOURS_PER_DAY } from '../shared/constants';
import { roundTo3dp } from '../utils/rounding';

/** Sentinel value for minimum-deviations search initialization */
const DEVIATION_SENTINEL = 1000000;
/** DIA search range: ±N hours around current DIA */
const DIA_SEARCH_RANGE = 2;
/** Peak time search range: ±N minutes around current peak */
const PEAK_SEARCH_RANGE = 10;
/** Peak time search step size (minutes) */
const PEAK_SEARCH_STEP = 5;
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

interface AutotunePrepResult extends CategorizeResult {
  diaDeviations?: DiaDeviation[];
  peakDeviations?: PeakDeviation[];
}

/** Prepare glucose data for autotune by finding meals and categorizing BG deviations */
function generate(inputs: AutotunePrepInputs): AutotunePrepResult {

  const treatments = findMeals(inputs);

  const opts: Parameters<typeof categorize>[0] = {
    treatments: treatments
  , profile: inputs.profile
  , pumpHistory: inputs.history
  , glucose: inputs.glucose
  , basalprofile: inputs.profile.basalprofile
  , pumpbasalprofile: inputs.pumpprofile.basalprofile
  , categorize_uam_as_basal: inputs.categorize_uam_as_basal
  };

  const autotunePrepOutput: AutotunePrepResult = categorize(opts);

  if (inputs.tune_insulin_curve) {
    if (opts.profile.curve === 'bilinear') {
      console.log('--tune-insulin-curve is set but only valid for exponential curves');
    } else {
      let minDeviations = DEVIATION_SENTINEL;
      let newDIA = 0;
      const diaDeviations: DiaDeviation[] = [];
      const peakDeviations: PeakDeviation[] = [];
      const currentDIA = opts.profile.dia;
      const currentPeak = opts.profile.insulinPeakTime;

      const consoleLog = console.log;
      console.log = function() {};

      const startDIA=currentDIA - DIA_SEARCH_RANGE;
      const endDIA=currentDIA + DIA_SEARCH_RANGE;
      // variables shared across dia and peak loops (were function-scoped with var)
      let sqrtDeviations: number;
      let deviations: number;
      let deviationsSq: number;
      let curveOutput: AutotunePrepResult;
      let basalGlucose: CategorizeGlucoseDatum[];
      let meanDeviation: number;
      let SMRDeviation: number;
      let RMSDeviation: number;
      for (let dia=startDIA; dia <= endDIA; ++dia) {
        sqrtDeviations = 0;
        deviations = 0;
        deviationsSq = 0;

        opts.profile.dia = dia;

        curveOutput = categorize(opts);
        basalGlucose = curveOutput.basalGlucoseData;

        for (let hourIdx=0; hourIdx < HOURS_PER_DAY; ++hourIdx) {
          for (let glucoseIdx=0; glucoseIdx < basalGlucose.length; ++glucoseIdx) {
            let BGTime: Date | undefined;

            if (basalGlucose[glucoseIdx].date) {
              BGTime = new Date(basalGlucose[glucoseIdx].date);
            } else if (basalGlucose[glucoseIdx].displayTime) {
              BGTime = new Date(String(basalGlucose[glucoseIdx].displayTime).replace('T', ' '));
            } else if (basalGlucose[glucoseIdx].dateString) {
              BGTime = new Date(basalGlucose[glucoseIdx].dateString);
            } else {
              consoleLog("Could not determine last BG time");
            }

            const entryHour = (BGTime ?? new Date(NaN)).getHours();
            if (hourIdx === entryHour) {
              sqrtDeviations += Math.pow(Math.abs(basalGlucose[glucoseIdx].deviation), 0.5);
              deviations += Math.abs(basalGlucose[glucoseIdx].deviation);
              deviationsSq += Math.pow(basalGlucose[glucoseIdx].deviation, 2);
            }
          }
        }

        meanDeviation = roundTo3dp(Math.abs(deviations/basalGlucose.length));
        SMRDeviation = roundTo3dp(Math.pow(sqrtDeviations/basalGlucose.length,2));
        RMSDeviation = roundTo3dp(Math.pow(deviationsSq/basalGlucose.length,0.5));
        consoleLog(`insulinEndTime ${dia} meanDeviation: ${meanDeviation} SMRDeviation: ${SMRDeviation} RMSDeviation: ${RMSDeviation} (mg/dL)`);
        diaDeviations.push({
            dia: dia,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotunePrepOutput.diaDeviations = diaDeviations;

        deviations = roundTo3dp(deviations);
        if (deviations < minDeviations) {
          minDeviations = roundTo3dp(deviations);
          newDIA = dia;
        }
      }

      minDeviations = DEVIATION_SENTINEL;

      let newPeak = 0;
      opts.profile.dia = currentDIA;
      if ( ! opts.profile.useCustomPeakTime === true && opts.profile.curve === "ultra-rapid" ) {
        opts.profile.insulinPeakTime = ULTRA_RAPID_PEAK;
      } else if ( ! opts.profile.useCustomPeakTime === true ) {
        opts.profile.insulinPeakTime = RAPID_ACTING_PEAK;
      }
      opts.profile.useCustomPeakTime = true;

      const startPeak=(Number(opts.profile.insulinPeakTime)) - PEAK_SEARCH_RANGE;
      const endPeak=(Number(opts.profile.insulinPeakTime)) + PEAK_SEARCH_RANGE;
      for (let peak=startPeak; peak <= endPeak; peak=(peak+PEAK_SEARCH_STEP)) {
        sqrtDeviations = 0;
        deviations = 0;
        deviationsSq = 0;

        opts.profile.insulinPeakTime = peak;

        curveOutput = categorize(opts);
        basalGlucose = curveOutput.basalGlucoseData;

        for (let hourIdx=0; hourIdx < HOURS_PER_DAY; ++hourIdx) {
          for (let glucoseIdx=0; glucoseIdx < basalGlucose.length; ++glucoseIdx) {
            let BGTime: Date | undefined;

            if (basalGlucose[glucoseIdx].date) {
              BGTime = new Date(basalGlucose[glucoseIdx].date);
            } else if (basalGlucose[glucoseIdx].displayTime) {
              BGTime = new Date(String(basalGlucose[glucoseIdx].displayTime).replace('T', ' '));
            } else if (basalGlucose[glucoseIdx].dateString) {
              BGTime = new Date(basalGlucose[glucoseIdx].dateString);
            } else {
              consoleLog("Could not determine last BG time");
            }

            const entryHour = (BGTime ?? new Date(NaN)).getHours();
            if (hourIdx === entryHour) {
              sqrtDeviations += Math.pow(Math.abs(basalGlucose[glucoseIdx].deviation), 0.5);
              deviations += Math.abs(basalGlucose[glucoseIdx].deviation);
              deviationsSq += Math.pow(basalGlucose[glucoseIdx].deviation, 2);
            }
          }
        }
        console.log(deviationsSq);

        meanDeviation = roundTo3dp(deviations/basalGlucose.length);
        SMRDeviation = roundTo3dp(Math.pow(sqrtDeviations/basalGlucose.length,2));
        RMSDeviation = roundTo3dp(Math.pow(deviationsSq/basalGlucose.length,0.5));
        consoleLog(`insulinPeakTime ${peak} meanDeviation: ${meanDeviation} SMRDeviation: ${SMRDeviation} RMSDeviation: ${RMSDeviation} (mg/dL)`);
        peakDeviations.push({
            peak: peak,
            meanDeviation: meanDeviation,
            SMRDeviation: SMRDeviation,
            RMSDeviation: RMSDeviation,
        });
        autotunePrepOutput.diaDeviations = diaDeviations;

        deviations = roundTo3dp(deviations);
        if (deviations < minDeviations) {
          minDeviations = roundTo3dp(deviations);
          newPeak = peak;
        }
      }

      autotunePrepOutput.peakDeviations = peakDeviations;

      console.log = consoleLog;
    }
  }

  return autotunePrepOutput;
}

export default generate;
export { generate };
export type { AutotunePrepInputs, AutotunePrepResult };
