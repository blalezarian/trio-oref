
import { getTime } from '../utils/medtronic-clock';
import { MIN_CARB_RATIO, MAX_CARB_RATIO } from '../constants';
import type { CarbRatioUnits } from '../types/index';

interface CarbRatioScheduleEntry {
  offset: number;
  ratio: number;
}

interface CarbRatioData {
  units: CarbRatioUnits;
  schedule?: CarbRatioScheduleEntry[];
}

/** Grams of carbs per exchange unit */
const GRAMS_PER_EXCHANGE = 12;

interface CarbsInputs {
  carbratio?: CarbRatioData;
}

function carbRatioLookup (inputs: CarbsInputs, profile: Record<string, unknown>, now?: Date): number | undefined {
    if (now === undefined) {
        now = new Date();
    }
    const carbratio_data = inputs.carbratio;
    if (carbratio_data !== undefined && carbratio_data.schedule !== undefined) {
        let carbRatio: CarbRatioScheduleEntry;
        if ((carbratio_data.units === "grams") || (carbratio_data.units === "exchanges")) {
            //carbratio_data.schedule.sort(function (a, b) { return a.offset > b.offset });
            carbRatio = carbratio_data.schedule[carbratio_data.schedule.length - 1];

            for (let i = 0; i < carbratio_data.schedule.length - 1; i++) {
                if ((now.getTime() >= getTime(carbratio_data.schedule[i].offset)) && (now.getTime() < getTime(carbratio_data.schedule[i + 1].offset))) {
                    carbRatio = carbratio_data.schedule[i];
                    break;
                }
            }
            // disallow impossibly high/low carbRatios due to bad decoding
            if (carbRatio!.ratio < MIN_CARB_RATIO || carbRatio!.ratio > MAX_CARB_RATIO) {
                console.error("Error: carbRatio of " + carbRatio!.ratio + " out of bounds.");
                return;
            }

            if (carbratio_data.units === "exchanges") {
                carbRatio!.ratio = GRAMS_PER_EXCHANGE / carbRatio!.ratio
            }
            return carbRatio!.ratio;
        } else {
            console.error("Error: Unsupported carb_ratio units " + carbratio_data.units);
            return;
        }
    //return carbRatio.ratio;
    //profile.carbratio = carbRatio.ratio;
    } else { return; }
}

interface CarbRatioLookupFn {
  (inputs: CarbsInputs, profile: Record<string, unknown>, now?: Date): number | undefined;
  carbRatioLookup: (inputs: CarbsInputs, profile: Record<string, unknown>, now?: Date) => number | undefined;
}

(carbRatioLookup as CarbRatioLookupFn).carbRatioLookup = carbRatioLookup;
export default carbRatioLookup as CarbRatioLookupFn;
