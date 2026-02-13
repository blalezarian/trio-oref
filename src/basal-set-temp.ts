'use strict';

import { round_basal } from './utils/round-basal';
import {
    DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER,
    DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER,
    MAX_TEMP_BASAL_DURATION_MINUTES,
} from './constants';

/** Duration tolerance (minutes) when comparing current temp to suggested */
const TEMP_DURATION_TOLERANCE_MINUTES = 10;
/** Upper rate tolerance factor for current temp comparison */
const RATE_TOLERANCE_HIGH = 1.2;
/** Lower rate tolerance factor for current temp comparison */
const RATE_TOLERANCE_LOW = 0.8;

interface TempBasalProfile {
  current_basal: number;
  max_daily_basal: number;
  max_basal: number;
  max_daily_safety_multiplier: number | null;
  current_basal_safety_multiplier: number | null;
  skip_neutral_temps?: boolean;
  model?: string;
}

interface TempBasalResult {
  reason: string;
  duration?: number;
  rate?: number;
}

interface CurrentTemp {
  duration: number;
  rate: number;
}

function reason(rT: TempBasalResult, msg: string): void {
  rT.reason = (rT.reason ? rT.reason + '. ' : '') + msg;
  console.error(msg);
}

interface TempBasalFunctionsInterface {
  getMaxSafeBasal: (profile: TempBasalProfile) => number;
  setTempBasal: (
    rate: number,
    duration: number,
    profile: TempBasalProfile,
    rT: TempBasalResult,
    currenttemp?: CurrentTemp,
  ) => TempBasalResult;
}

const tempBasalFunctions = {} as TempBasalFunctionsInterface;

tempBasalFunctions.getMaxSafeBasal = (profile: TempBasalProfile): number => {

    const max_daily_safety_multiplier = (isNaN(profile.max_daily_safety_multiplier!) || profile.max_daily_safety_multiplier === null) ? DEFAULT_MAX_DAILY_SAFETY_MULTIPLIER : profile.max_daily_safety_multiplier;
    const current_basal_safety_multiplier = (isNaN(profile.current_basal_safety_multiplier!) || profile.current_basal_safety_multiplier === null) ? DEFAULT_CURRENT_BASAL_SAFETY_MULTIPLIER : profile.current_basal_safety_multiplier;

    return Math.min(profile.max_basal, max_daily_safety_multiplier * profile.max_daily_basal, current_basal_safety_multiplier * profile.current_basal);
};

tempBasalFunctions.setTempBasal = (rate: number, duration: number, profile: TempBasalProfile, rT: TempBasalResult, currenttemp?: CurrentTemp): TempBasalResult => {
    const maxSafeBasal = tempBasalFunctions.getMaxSafeBasal(profile);

    if (rate < 0) {
        rate = 0;
    } else if (rate > maxSafeBasal) {
        rate = maxSafeBasal;
    }

    const suggestedRate = round_basal(rate, profile);
    if (currenttemp?.duration !== undefined && currenttemp?.rate !== undefined && currenttemp.duration > (duration-TEMP_DURATION_TOLERANCE_MINUTES) && currenttemp.duration <= MAX_TEMP_BASAL_DURATION_MINUTES && suggestedRate <= currenttemp.rate * RATE_TOLERANCE_HIGH && suggestedRate >= currenttemp.rate * RATE_TOLERANCE_LOW && duration > 0 ) {
        rT.reason += " "+currenttemp.duration+"m left and " + currenttemp.rate + " ~ req " + suggestedRate + "U/hr: no temp required";
        return rT;
    }

    if (suggestedRate === profile.current_basal) {
      if (profile.skip_neutral_temps === true) {
        if (currenttemp?.duration !== undefined && currenttemp.duration > 0) {
          reason(rT, 'Suggested rate is same as profile rate, a temp basal is active, canceling current temp');
          rT.duration = 0;
          rT.rate = 0;
          return rT;
        } else {
          reason(rT, 'Suggested rate is same as profile rate, no temp basal is active, doing nothing');
          return rT;
        }
      } else {
        reason(rT, 'Setting neutral temp basal of ' + profile.current_basal + 'U/hr');
        rT.duration = duration;
        rT.rate = suggestedRate;
        return rT;
      }
    } else {
      rT.duration = duration;
      rT.rate = suggestedRate;
      return rT;
    }
};

export default tempBasalFunctions;
