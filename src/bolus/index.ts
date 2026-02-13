import type { PumpHistoryEvent, PumpHistoryEventType } from '../types/index';
import { MS_PER_MINUTE } from '../shared/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minutes window for grouping related bolus events */
const BOLUS_GROUPING_MINUTES = 2;
/** Multiplier to convert ratio to percentage */
const PERCENT_MULTIPLIER = 100;
/** Path to IOB monitor file (read at runtime on device) */
const IOB_FILE_PATH = './monitor/iob.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BolusTreatment {
    _type: PumpHistoryEventType | (string & {});
    timestamp: string;
    /** Pass-through pump history fields */
    [key: string]: unknown;
}

export interface BolusResult {
    eventType?: string;
    insulin?: string;
    carbs?: string;
    ratio?: string;
    bg?: string;
    glucose?: string;
    glucoseType?: string;
    duration?: string;
    notes?: string;
    created_at?: string;
    timestamp?: string;
    /** Pass-through pump history fields */
    [key: string]: unknown;
}

interface BolusAccumulator {
    // --- Wizard data ---
    carbs?: string;
    ratio?: string;
    bg?: string;
    glucose?: string;
    glucoseType?: string;
    wizard?: PumpHistoryEvent;

    // --- Bolus data ---
    duration?: string;
    square?: PumpHistoryEvent;
    bolus?: PumpHistoryEvent;

    // --- Result fields ---
    eventType?: string;
    insulin?: string;
    notes?: string;
    created_at?: string;
    timestamp?: string;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/** Reduce pump history events into categorized bolus results */
export function reduceBoluses(treatments: BolusTreatment[]): BolusResult[] {
    const results: BolusResult[] = [];
    const processedEvents: BolusTreatment[] = [];

    for (const [treatmentIdx, treatment] of treatments.entries()) {
        if (wasAlreadyProcessed(treatment, processedEvents)) continue;

        switch (treatment._type) {
            case 'Bolus':
            case 'BolusWizard': {
                const relatedEvents = findRelatedEvents(
                    treatment,
                    treatments.slice(treatmentIdx + 1),
                    BOLUS_GROUPING_MINUTES,
                );
                const bolusGroup = [
                    treatment,
                    ...relatedEvents,
                ] as PumpHistoryEvent[];
                results.push(processBolusGroup(bolusGroup, processedEvents));
                break;
            }
            case 'JournalEntryMealMarker':
                // Mutates input, matching original behavior
                (treatment as BolusResult).carbs = treatment.carb_input as string;
                (treatment as BolusResult).eventType = 'Carb Correction';
                results.push(treatment as BolusResult);
                break;
            default:
                results.push(treatment as BolusResult);
                break;
        }
    }

    return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if an event was already processed in a previous bolus group */
export function wasAlreadyProcessed(
    event: BolusTreatment,
    processedEvents: BolusTreatment[],
): boolean {
    return processedEvents.some(
        (processed) => processed.timestamp === event.timestamp
            && event._type === processed._type,
    );
}

/** Find events within a time window from an origin event */
export function findRelatedEvents(
    origin: BolusTreatment,
    candidates: BolusTreatment[],
    windowMinutes: number,
): BolusTreatment[] {
    const windowMs = windowMinutes * MS_PER_MINUTE;
    const originMs = Date.parse(origin.timestamp);
    return candidates.slice().filter(
        (candidate) => originMs - Date.parse(candidate.timestamp) <= windowMs,
    );
}

/** Finalize a bolus group accumulator into a result with annotations */
export function finalizeBolusGroup(accumulator: BolusAccumulator): BolusResult {
    accumulator.eventType = '<none>';

    // --- Compute total insulin ---
    const squareAmount = accumulator.square
        ? (accumulator.square.amount as number)
        : 0;
    const bolusAmount = accumulator.bolus
        ? (accumulator.bolus.amount as number)
        : 0;
    const totalInsulin = squareAmount + bolusAmount;

    const hasInsulin = totalInsulin > 0;
    const hasCarbs = !!accumulator.carbs && Number(accumulator.carbs) > 0;

    // --- Build annotations ---
    const annotations: string[] = [];
    const addNote = (...args: unknown[]): void => {
        annotations.push(args.join(' '));
    };

    // Bolus type classification
    if (accumulator.square && accumulator.bolus) {
        addNote('DualWave bolus for', accumulator.square.duration, 'minutes');
    } else if (accumulator.square && accumulator.wizard) {
        addNote('Square wave bolus for', accumulator.square.duration, 'minutes');
    } else if (accumulator.square) {
        addNote('Solo Square wave bolus for', accumulator.square.duration, 'minutes');
        addNote('No bolus wizard used.');
    } else if (accumulator.bolus && accumulator.wizard) {
        addNote('Normal bolus with wizard.');
    } else if (accumulator.bolus) {
        addNote('Normal bolus (solo, no bolus wizard).');
    }

    // Read IOB file if insulin was delivered
    if (hasInsulin) {
        const fs = require('fs');
        if (fs.existsSync(IOB_FILE_PATH)) {
            const iob = JSON.parse(fs.readFileSync(IOB_FILE_PATH));
            if (iob && Array.isArray(iob) && iob.length) {
                addNote('Calculated IOB:', iob[0].iob);
            }
        }
    }

    // Delivery details
    if (accumulator.bolus) {
        addNote('Programmed bolus', accumulator.bolus.programmed);
        addNote('Delivered bolus', accumulator.bolus.amount);
        const bolusPercent = (accumulator.bolus.amount as number)
            / (accumulator.bolus.programmed as number) * PERCENT_MULTIPLIER;
        addNote('Percent delivered: ', bolusPercent.toString() + '%');
    }
    if (accumulator.square) {
        addNote('Programmed square', accumulator.square.programmed);
        addNote('Delivered square', accumulator.square.amount);
        const squarePercent = (accumulator.square.amount as number)
            / (accumulator.square.programmed as number) * PERCENT_MULTIPLIER;
        addNote('Success: ', squarePercent.toString() + '%');
    }

    // Wizard details
    if (accumulator.wizard) {
        accumulator.created_at = accumulator.wizard.timestamp;
        addNote('Food estimate', accumulator.wizard.food_estimate);
        addNote('Correction estimate', accumulator.wizard.correction_estimate);
        addNote('Bolus estimate', accumulator.wizard.bolus_estimate);
        addNote('Target low', accumulator.wizard.bg_target_low);
        addNote('Target high', accumulator.wizard.bg_target_high);
        const hypotheticalDelta = (accumulator.wizard.sensitivity as number) * totalInsulin * -1;
        addNote('Hypothetical glucose delta', hypotheticalDelta);
        if (accumulator.bg && Number(accumulator.bg) > 0) {
            addNote('Glucose was:', accumulator.bg);
        }
    }

    // --- Classify event type ---
    if (hasCarbs && hasInsulin) {
        accumulator.eventType = 'Meal Bolus';
    } else if (hasCarbs) {
        accumulator.eventType = 'Carb Correction';
    } else if (hasInsulin) {
        accumulator.eventType = 'Correction Bolus';
    }

    // --- Finalize fields ---
    if (annotations.length > 0) {
        accumulator.notes = annotations.join('\n');
    }

    // Preserve original behavior: stores raw number 0 when no insulin,
    // string representation when > 0
    (accumulator as Record<string, unknown>).insulin = totalInsulin;
    if (totalInsulin) {
        accumulator.insulin = totalInsulin.toString();
    }

    return accumulator as BolusResult;
}

/** Process a group of related bolus events into a single result */
export function processBolusGroup(
    events: PumpHistoryEvent[],
    processedEvents: BolusTreatment[],
): BolusResult {
    const accumulator: BolusAccumulator = {};

    for (const event of events) {
        if (!event) {
            console.error(`XXX ${JSON.stringify(event)} ${JSON.stringify(events)}`);
            break;
        }

        if (event._type === 'BolusWizard') {
            accumulator.carbs = (event.carb_input as number).toString();
            accumulator.ratio = (event.carb_ratio as number).toString();
            if (event.bg) {
                accumulator.bg = event.bg.toString();
                accumulator.glucose = event.bg.toString();
                accumulator.glucoseType = event._type;
            }
            accumulator.wizard = event;
            accumulator.created_at = accumulator.timestamp = event.timestamp;
            processedEvents.push(event as BolusTreatment);
        }

        if (event._type === 'Bolus') {
            accumulator.duration = (event.duration as number).toString();
            if (event.duration && event.duration > 0) {
                accumulator.square = event;
            } else {
                if (accumulator.bolus) {
                    // Mutates input event, matching original behavior
                    accumulator.bolus.amount = (accumulator.bolus.amount as number)
                        + (event.amount as number);
                } else {
                    accumulator.bolus = event;
                }
            }
            accumulator.created_at = accumulator.timestamp = event.timestamp;
            processedEvents.push(event as BolusTreatment);
        }

        if (accumulator.bolus && accumulator.wizard) break;
    }

    return finalizeBolusGroup(accumulator);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export default reduceBoluses;
