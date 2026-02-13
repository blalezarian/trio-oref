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

function carbRatioLookup (inputs: CarbsInputs, now: Date = new Date()): number | undefined {
    const carbratio_data = inputs.carbratio;
    if (!carbratio_data?.schedule) {
        return;
    }
    if (carbratio_data.units !== "grams" && carbratio_data.units !== "exchanges") {
        console.error(`Error: Unsupported carb_ratio units ${carbratio_data.units}`);
        return;
    }

    const schedule = carbratio_data.schedule;
    let carbRatio = schedule[schedule.length - 1];

    for (let i = 0; i < schedule.length - 1; i++) {
        if (now.getTime() >= getTime(schedule[i].offset) && now.getTime() < getTime(schedule[i + 1].offset)) {
            carbRatio = schedule[i];
            break;
        }
    }

    // disallow impossibly high/low carbRatios due to bad decoding
    if (carbRatio.ratio < MIN_CARB_RATIO || carbRatio.ratio > MAX_CARB_RATIO) {
        console.error(`Error: carbRatio of ${carbRatio.ratio} out of bounds.`);
        return;
    }

    if (carbratio_data.units === "exchanges") {
        carbRatio.ratio = GRAMS_PER_EXCHANGE / carbRatio.ratio;
    }
    return carbRatio.ratio;
}

export { carbRatioLookup };
export type { CarbRatioScheduleEntry, CarbRatioData, CarbsInputs };
