import { getTime } from '../utils/medtronic-clock';
import { MIN_CARB_RATIO, MAX_CARB_RATIO } from '../shared/constants';
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

function carbRatioLookup(inputs: CarbsInputs, now: Date = new Date()): number | undefined {
    const carbratioData = inputs.carbratio;
    if (!carbratioData?.schedule) {
        return;
    }
    if (carbratioData.units !== "grams" && carbratioData.units !== "exchanges") {
        console.error(`Error: Unsupported carb_ratio units ${carbratioData.units}`);
        return;
    }

    const schedule = carbratioData.schedule;
    let carbRatio = schedule[schedule.length - 1];

    for (let entryIdx = 0; entryIdx < schedule.length - 1; entryIdx++) {
        if (now.getTime() >= getTime(schedule[entryIdx].offset) && now.getTime() < getTime(schedule[entryIdx + 1].offset)) {
            carbRatio = schedule[entryIdx];
            break;
        }
    }

    // disallow impossibly high/low carbRatios due to bad decoding
    if (carbRatio.ratio < MIN_CARB_RATIO || carbRatio.ratio > MAX_CARB_RATIO) {
        console.error(`Error: carbRatio of ${carbRatio.ratio} out of bounds.`);
        return;
    }

    if (carbratioData.units === "exchanges") {
        carbRatio.ratio = GRAMS_PER_EXCHANGE / carbRatio.ratio;
    }
    return carbRatio.ratio;
}

export { carbRatioLookup };
export type { CarbRatioScheduleEntry, CarbRatioData, CarbsInputs };
