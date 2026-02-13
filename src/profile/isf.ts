import { MINUTES_PER_DAY } from '../shared/constants';
import { toMinuteOfDay } from './basal';

/** Error sentinel returned when ISF schedule has invalid first offset */
const ISF_LOOKUP_ERROR = -1;

interface ISFScheduleEntry {
  offset: number;
  sensitivity: number;
  endOffset?: number;
}

interface ISFData {
  sensitivities: ISFScheduleEntry[];
}

// Module-level cache: the last looked-up schedule entry is cached to avoid
// re-sorting on consecutive calls within the same time window.
// NOTE: this is intentional mutable state from the original algorithm — do not remove.
let lastResult: ISFScheduleEntry | null = null;

/** Reset the module-level ISF cache (for testing) */
function resetISFCache(): void {
    lastResult = null;
}

/** Look up the ISF (mg/dL per unit) active at the given timestamp */
function isfLookup(isfData: ISFData, timestamp: Date = new Date()): number {
    const nowMinutes = toMinuteOfDay(timestamp);

    if (lastResult && nowMinutes >= lastResult.offset && nowMinutes < (lastResult.endOffset ?? MINUTES_PER_DAY)) {
        return lastResult.sensitivity;
    }

    const sorted = [...isfData.sensitivities].sort((a, b) => a.offset - b.offset);

    if (sorted[0].offset !== 0) {
        return ISF_LOOKUP_ERROR;
    }

    let isfSchedule = sorted[sorted.length - 1];
    let endMinutes = MINUTES_PER_DAY;

    for (let entryIdx = 0; entryIdx < sorted.length - 1; entryIdx++) {
        if (nowMinutes >= sorted[entryIdx].offset && nowMinutes < sorted[entryIdx + 1].offset) {
            endMinutes = sorted[entryIdx + 1].offset;
            isfSchedule = sorted[entryIdx];
            break;
        }
    }

    lastResult = isfSchedule;
    lastResult.endOffset = endMinutes;

    return isfSchedule.sensitivity;
}

export { isfLookup, resetISFCache, ISF_LOOKUP_ERROR };
export type { ISFScheduleEntry, ISFData };
