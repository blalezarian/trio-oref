import type { PumpHistoryEvent, CarbTreatment, NightscoutEventType } from '../types/index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timestamp matching tolerance for deduplication (ms) */
const TIMESTAMP_MATCH_TOLERANCE_MS = 2000;

/** Nightscout Care Portal event types that carry carb data */
const CARE_PORTAL_CARB_TYPES: ReadonlySet<NightscoutEventType> = new Set<NightscoutEventType>([
    'Meal Bolus',
    'Correction Bolus',
    'Snack Bolus',
    'Bolus Wizard',
    'Carb Correction',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MealHistoryInputs {
    history: PumpHistoryEvent[];
    carbs: PumpHistoryEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether an entry with the same timestamp (±2s) and property already exists */
function hasDuplicateEntry(
    entries: CarbTreatment[],
    timestamp: string,
    property: keyof CarbTreatment,
): boolean {
    const targetTime = new Date(timestamp).getTime();
    const toleranceMin = targetTime - TIMESTAMP_MATCH_TOLERANCE_MS;
    const toleranceMax = targetTime + TIMESTAMP_MATCH_TOLERANCE_MS;

    for (const entry of entries) {
        if (entry[property] === undefined) {
            continue;
        }
        if (entry.timestamp === timestamp) {
            return true;
        }
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime > toleranceMin && entryTime < toleranceMax) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Extract carb and bolus treatments from pump history and Nightscout carb history */
function findMealInputs(inputs: MealHistoryInputs): CarbTreatment[] {
    const { history: pumpHistory, carbs: carbHistory } = inputs;
    const mealInputs: CarbTreatment[] = [];
    const deferredBolusWizards: PumpHistoryEvent[] = [];

    // --- Phase 1: Nightscout carb history entries ---
    for (const entry of carbHistory) {
        if (!entry.carbs || !entry.created_at) {
            continue;
        }
        if (hasDuplicateEntry(mealInputs, entry.created_at, 'carbs')) {
            continue;
        }
        mealInputs.push({
            timestamp: entry.created_at,
            carbs: entry.carbs,
            nsCarbs: entry.carbs,
        });
    }

    // --- Phase 2: Pump history entries ---
    for (const entry of pumpHistory) {
        // Medtronic Bolus events
        if (entry._type === 'Bolus' && entry.timestamp) {
            if (!hasDuplicateEntry(mealInputs, entry.timestamp, 'bolus')) {
                mealInputs.push({
                    timestamp: entry.timestamp,
                    bolus: entry.amount,
                });
            }
            continue;
        }

        // BolusWizard: defer until all boluses are processed
        if (entry._type === 'BolusWizard' && entry.timestamp) {
            deferredBolusWizards.push(entry);
            continue;
        }

        // Nightscout Care Portal carb events
        if (CARE_PORTAL_CARB_TYPES.has(entry._type as NightscoutEventType) && entry.created_at) {
            if (!hasDuplicateEntry(mealInputs, entry.created_at, 'carbs')) {
                mealInputs.push({
                    timestamp: entry.created_at,
                    carbs: entry.carbs,
                    nsCarbs: entry.carbs,
                });
            }
            continue;
        }

        // xDrip entries (uses created_at as timestamp, dedup checks against timestamp)
        if (entry.enteredBy === 'xdrip') {
            if (!hasDuplicateEntry(mealInputs, entry.timestamp ?? '', 'carbs')) {
                mealInputs.push({
                    timestamp: entry.created_at as string,
                    carbs: entry.carbs,
                    nsCarbs: entry.carbs,
                    bolus: entry.insulin,
                });
            }
            continue;
        }

        // Generic entries with carbs > 0
        if ((entry.carbs ?? 0) > 0) {
            if (!hasDuplicateEntry(mealInputs, entry.timestamp ?? '', 'carbs')) {
                mealInputs.push({
                    timestamp: entry.created_at as string,
                    carbs: entry.carbs,
                    nsCarbs: entry.carbs,
                    bolus: entry.insulin,
                });
            }
            continue;
        }

        // Medtronic JournalEntryMealMarker
        if (entry._type === 'JournalEntryMealMarker' && (entry.carb_input ?? 0) > 0 && entry.timestamp) {
            if (!hasDuplicateEntry(mealInputs, entry.timestamp, 'carbs')) {
                mealInputs.push({
                    timestamp: entry.timestamp,
                    carbs: entry.carb_input,
                    journalCarbs: entry.carb_input,
                });
            }
        }
    }

    // --- Phase 3: Process deferred BolusWizard entries ---
    // Processed last to ensure we've seen all corresponding Bolus entries.
    for (let wizardIdx = 0; wizardIdx < deferredBolusWizards.length; wizardIdx++) {
        const entry = deferredBolusWizards[wizardIdx];
        const timestamp = entry.timestamp ?? '';

        // Skip if a carb entry with same timestamp already exists
        if (hasDuplicateEntry(mealInputs, timestamp, 'carbs')) {
            continue;
        }

        // Only add if there's a matching Bolus entry; otherwise log and skip
        if (!hasDuplicateEntry(mealInputs, timestamp, 'bolus')) {
            console.error(`Skipping bolus wizard entry ${wizardIdx} in the pump history with ${entry.carb_input} g carbs and no insulin.`);
            if (entry.carb_input === 0) {
                console.error("This is caused by a BolusWizard without carbs. If you specified insulin, it will be noted as a seperate Bolus");
            }
            if (entry.timestamp) {
                console.error(`Timestamp of bolus wizard: ${entry.timestamp}`);
            }
            continue;
        }

        mealInputs.push({
            timestamp,
            carbs: entry.carb_input,
            bwCarbs: entry.carb_input,
        });
    }

    return mealInputs;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default findMealInputs;
export {
    findMealInputs,
    // Helpers
    hasDuplicateEntry,
};
export type { MealHistoryInputs };
