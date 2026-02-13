/** Rounding scale for basal rate precision (3 decimal places) */
const BASAL_ROUND_SCALE = 1000;

interface BasalScheduleEntry {
  i?: number;
  minutes?: number;
  rate: number;
}

interface BasalInputs {
  basals: BasalScheduleEntry[];
  settings: { maxBasal: number };
}

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/** Return basal rate (U/hr) at the provided time of day */
function getCurrentBasalRate(schedules: BasalScheduleEntry[], now: Date = new Date()): number | undefined {
    const sorted = sortByScheduleIndex(schedules);
    const lastRate = sorted[sorted.length - 1].rate;
    if (lastRate === 0) {
        console.log(`ERROR: bad basal schedule ${JSON.stringify(schedules)}`);
        return;
    }
    const basalRate = findActiveRate(sorted, toMinuteOfDay(now));
    return Math.round(basalRate * BASAL_ROUND_SCALE) / BASAL_ROUND_SCALE;
}

/** Return the highest rate in the basal schedule */
function getMaxDailyBasalRate(inputs: BasalInputs): number {
    const maxRate = inputs.basals.reduce((max, entry) =>
        Number(entry.rate) > Number(max.rate) ? entry : max
    );
    return (Number(maxRate.rate) * BASAL_ROUND_SCALE) / BASAL_ROUND_SCALE;
}

/** Return the pump's configured max basal rate */
function getMaxBasalRate(inputs: BasalInputs): number {
    return inputs.settings.maxBasal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Date to its minute-of-day (0–1439) */
function toMinuteOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

/** Sort basal schedule entries by their schedule index (copies, does not mutate) */
function sortByScheduleIndex(schedules: BasalScheduleEntry[]): BasalScheduleEntry[] {
    return [...schedules].sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
}

/** Find the active rate from a sorted schedule for a given minute-of-day */
function findActiveRate(sorted: BasalScheduleEntry[], minuteOfDay: number): number {
    for (let entryIdx = 0; entryIdx < sorted.length - 1; entryIdx++) {
        if (minuteOfDay >= (sorted[entryIdx].minutes ?? 0) && minuteOfDay < (sorted[entryIdx + 1].minutes ?? 0)) {
            return sorted[entryIdx].rate;
        }
    }
    return sorted[sorted.length - 1].rate;
}

export {
    getCurrentBasalRate,
    getMaxDailyBasalRate,
    getMaxBasalRate,
    sortByScheduleIndex,
    findActiveRate,
    toMinuteOfDay,
};
export type { BasalScheduleEntry, BasalInputs };
