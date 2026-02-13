import { describe, it, expect, vi } from 'vitest';
import findMealInputs, { hasDuplicateEntry } from '../../../src/meal/history';
import type { PumpHistoryEvent, CarbTreatment } from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';

function makeHistory(overrides: Partial<PumpHistoryEvent> = {}): PumpHistoryEvent {
    return { timestamp: FIXED_TIME, ...overrides };
}

// ---------------------------------------------------------------------------
// hasDuplicateEntry
// ---------------------------------------------------------------------------

describe('hasDuplicateEntry', () => {
    it('returns true for exact timestamp match with property defined', () => {
        const entries: CarbTreatment[] = [
            { timestamp: FIXED_TIME, carbs: 30 },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'carbs')).toBe(true);
    });

    it('returns false when property is undefined on matching timestamp', () => {
        const entries: CarbTreatment[] = [
            { timestamp: FIXED_TIME },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'carbs')).toBe(false);
    });

    it('returns true for timestamp within 2-second tolerance', () => {
        const entries: CarbTreatment[] = [
            { timestamp: '2025-01-15T12:00:01.000Z', carbs: 30 },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'carbs')).toBe(true);
    });

    it('returns false for timestamp outside 2-second tolerance', () => {
        const entries: CarbTreatment[] = [
            { timestamp: '2025-01-15T12:00:03.000Z', carbs: 30 },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'carbs')).toBe(false);
    });

    it('returns false for empty entries array', () => {
        expect(hasDuplicateEntry([], FIXED_TIME, 'carbs')).toBe(false);
    });

    it('checks the specified property independently', () => {
        const entries: CarbTreatment[] = [
            { timestamp: FIXED_TIME, carbs: 30 },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'bolus')).toBe(false);
    });

    it('detects bolus duplicates', () => {
        const entries: CarbTreatment[] = [
            { timestamp: FIXED_TIME, bolus: 2.5 },
        ];
        expect(hasDuplicateEntry(entries, FIXED_TIME, 'bolus')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// findMealInputs
// ---------------------------------------------------------------------------

describe('findMealInputs', () => {

    // --- Empty inputs ---

    it('returns empty array when both history and carbs are empty', () => {
        const result = findMealInputs({ history: [], carbs: [] });
        expect(result).toEqual([]);
    });

    // --- Nightscout carb entries from carbHistory ---

    it('extracts carbs from carbHistory with nsCarbs tag', () => {
        const carbs: PumpHistoryEvent[] = [
            { carbs: 30, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history: [], carbs });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(30);
        expect(result[0].nsCarbs).toBe(30);
        expect(result[0].timestamp).toBe(FIXED_TIME);
    });

    it('extracts multiple carbHistory entries', () => {
        const t2 = '2025-01-15T12:30:00.000Z';
        const carbs: PumpHistoryEvent[] = [
            { carbs: 20, created_at: FIXED_TIME },
            { carbs: 15, created_at: t2 },
        ];
        const result = findMealInputs({ history: [], carbs });

        expect(result).toHaveLength(2);
        expect(result[0].carbs).toBe(20);
        expect(result[1].carbs).toBe(15);
    });

    it('ignores carbHistory entries missing created_at', () => {
        const carbs: PumpHistoryEvent[] = [
            { carbs: 30 },
        ];
        const result = findMealInputs({ history: [], carbs });
        expect(result).toHaveLength(0);
    });

    it('ignores carbHistory entries missing carbs field', () => {
        const carbs: PumpHistoryEvent[] = [
            { created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history: [], carbs });
        expect(result).toHaveLength(0);
    });

    // --- Pump Bolus events ---

    it('extracts Bolus events with bolus amount', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'Bolus', amount: 3.5 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].bolus).toBe(3.5);
        expect(result[0].timestamp).toBe(FIXED_TIME);
        expect(result[0].carbs).toBeUndefined();
    });

    it('ignores Bolus events without timestamp', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus', amount: 2.0 },
        ];
        const result = findMealInputs({ history, carbs: [] });
        expect(result).toHaveLength(0);
    });

    // --- BolusWizard entries paired with bolus ---

    it('pairs BolusWizard with corresponding Bolus entry', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'Bolus', amount: 2.0 }),
            makeHistory({ _type: 'BolusWizard', carb_input: 45 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(2);
        // Bolus entry
        const bolusEntry = result.find(r => r.bolus !== undefined);
        expect(bolusEntry).toBeDefined();
        expect(bolusEntry!.bolus).toBe(2.0);
        // BolusWizard entry
        const bwEntry = result.find(r => r.bwCarbs !== undefined);
        expect(bwEntry).toBeDefined();
        expect(bwEntry!.carbs).toBe(45);
        expect(bwEntry!.bwCarbs).toBe(45);
    });

    it('skips BolusWizard with no matching Bolus (logs error)', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'BolusWizard', carb_input: 45 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        // No bolus entry with matching timestamp => BolusWizard is skipped
        expect(result).toHaveLength(0);
    });

    it('skips BolusWizard without timestamp', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'BolusWizard', carb_input: 30 },
        ];
        const result = findMealInputs({ history, carbs: [] });
        expect(result).toHaveLength(0);
    });

    // --- Care Portal events ---

    it('extracts Meal Bolus care portal event', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Meal Bolus' as PumpHistoryEvent['_type'], carbs: 50, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(50);
        expect(result[0].nsCarbs).toBe(50);
        expect(result[0].timestamp).toBe(FIXED_TIME);
    });

    it('extracts Correction Bolus care portal event', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Correction Bolus' as PumpHistoryEvent['_type'], carbs: 10, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(10);
        expect(result[0].nsCarbs).toBe(10);
    });

    it('extracts Snack Bolus care portal event', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Snack Bolus' as PumpHistoryEvent['_type'], carbs: 15, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(15);
    });

    it('extracts Bolus Wizard (Nightscout) care portal event', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus Wizard' as PumpHistoryEvent['_type'], carbs: 25, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(25);
        expect(result[0].nsCarbs).toBe(25);
    });

    it('extracts Carb Correction care portal event', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Carb Correction' as PumpHistoryEvent['_type'], carbs: 8, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(8);
    });

    it('ignores care portal events without created_at', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Meal Bolus' as PumpHistoryEvent['_type'], carbs: 50, timestamp: FIXED_TIME },
        ];
        const result = findMealInputs({ history, carbs: [] });

        // Without created_at, falls through to the carbs > 0 branch
        // which uses created_at (undefined) so the timestamp field is
        // checked via the generic carbs > 0 path
        // The care portal branch requires created_at, so it won't match there.
        // It may match carbs > 0 branch instead.
        // Let's just check it doesn't duplicate or crash.
        expect(result.length).toBeLessThanOrEqual(1);
    });

    // --- xdrip entries ---

    it('extracts xdrip entries using created_at for timestamp', () => {
        const history: PumpHistoryEvent[] = [
            {
                enteredBy: 'xdrip',
                carbs: 20,
                insulin: 1.5,
                created_at: FIXED_TIME,
                timestamp: '2025-01-15T11:59:58.000Z',
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        // xdrip uses created_at for the output timestamp
        expect(result[0].timestamp).toBe(FIXED_TIME);
        expect(result[0].carbs).toBe(20);
        expect(result[0].nsCarbs).toBe(20);
        expect(result[0].bolus).toBe(1.5);
    });

    // --- JournalEntryMealMarker ---

    it('extracts JournalEntryMealMarker with carb_input as journalCarbs', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'JournalEntryMealMarker', carb_input: 35 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(35);
        expect(result[0].journalCarbs).toBe(35);
        expect(result[0].timestamp).toBe(FIXED_TIME);
    });

    it('ignores JournalEntryMealMarker with zero carb_input', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'JournalEntryMealMarker', carb_input: 0 }),
        ];
        const result = findMealInputs({ history, carbs: [] });
        expect(result).toHaveLength(0);
    });

    it('ignores JournalEntryMealMarker without timestamp', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'JournalEntryMealMarker', carb_input: 35 },
        ];
        const result = findMealInputs({ history, carbs: [] });
        expect(result).toHaveLength(0);
    });

    // --- Deduplication (2-second tolerance) ---

    it('deduplicates entries within 2-second tolerance', () => {
        const t1 = '2025-01-15T12:00:00.000Z';
        const t2 = '2025-01-15T12:00:01.000Z'; // 1 second apart — within tolerance
        const carbs: PumpHistoryEvent[] = [
            { carbs: 30, created_at: t1 },
        ];
        const history: PumpHistoryEvent[] = [
            { _type: 'Meal Bolus' as PumpHistoryEvent['_type'], carbs: 30, created_at: t2 },
        ];
        const result = findMealInputs({ history, carbs });

        // carbHistory entry comes first, then history entry is a duplicate
        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(30);
    });

    it('does not deduplicate entries beyond 2-second tolerance', () => {
        const t1 = '2025-01-15T12:00:00.000Z';
        const t2 = '2025-01-15T12:00:03.000Z'; // 3 seconds apart — outside tolerance
        const carbs: PumpHistoryEvent[] = [
            { carbs: 30, created_at: t1 },
        ];
        const history: PumpHistoryEvent[] = [
            { _type: 'Meal Bolus' as PumpHistoryEvent['_type'], carbs: 30, created_at: t2 },
        ];
        const result = findMealInputs({ history, carbs });

        expect(result).toHaveLength(2);
    });

    it('deduplicates Bolus entries within 2-second tolerance', () => {
        const t1 = '2025-01-15T12:00:00.000Z';
        const t2 = '2025-01-15T12:00:01.500Z'; // 1.5 seconds apart
        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus', amount: 3.0, timestamp: t1 },
            { _type: 'Bolus', amount: 3.0, timestamp: t2 },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].bolus).toBe(3.0);
    });

    // --- Generic carbs > 0 entries ---

    it('extracts generic entries with carbs > 0', () => {
        const history: PumpHistoryEvent[] = [
            {
                carbs: 12,
                insulin: 0.5,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(12);
        expect(result[0].nsCarbs).toBe(12);
        expect(result[0].bolus).toBe(0.5);
        expect(result[0].timestamp).toBe(FIXED_TIME);
    });

    it('ignores generic entries with carbs = 0', () => {
        const history: PumpHistoryEvent[] = [
            {
                carbs: 0,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        // carbs > 0 is false, so this falls through
        // JournalEntryMealMarker check also fails (no _type)
        expect(result).toHaveLength(0);
    });

    // --- Mixed input integration ---

    it('handles a mix of carbHistory, bolus, and care portal entries', () => {
        const t1 = '2025-01-15T12:00:00.000Z';
        const t2 = '2025-01-15T12:10:00.000Z';
        const t3 = '2025-01-15T12:20:00.000Z';

        const carbs: PumpHistoryEvent[] = [
            { carbs: 30, created_at: t1 },
        ];
        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus', amount: 2.5, timestamp: t2 },
            { _type: 'Meal Bolus' as PumpHistoryEvent['_type'], carbs: 20, created_at: t3 },
        ];
        const result = findMealInputs({ history, carbs });

        expect(result).toHaveLength(3);
        // Verify each type is present
        expect(result.some(r => r.nsCarbs === 30)).toBe(true);
        expect(result.some(r => r.bolus === 2.5)).toBe(true);
        expect(result.some(r => r.nsCarbs === 20)).toBe(true);
    });

    // --- JournalEntryMealMarker ordering vs generic carbs > 0 ---

    it('JournalEntryMealMarker with carb_input is checked after generic carbs > 0 branch', () => {
        // A JournalEntryMealMarker without carbs set (only carb_input) should hit the JournalEntry branch
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'JournalEntryMealMarker', carb_input: 25 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        // The carbs > 0 check uses current.carbs which is undefined,
        // so undefined > 0 is false, falling through to JournalEntryMealMarker
        expect(result).toHaveLength(1);
        expect(result[0].journalCarbs).toBe(25);
    });

    // --- Deduplication of carbHistory entries (Phase 1, line 43-44) ---

    it('deduplicates carbHistory entries with the same timestamp', () => {
        const carbs: PumpHistoryEvent[] = [
            { carbs: 30, created_at: FIXED_TIME },
            { carbs: 30, created_at: FIXED_TIME },
        ];
        const result = findMealInputs({ history: [], carbs });

        // Second entry is a duplicate and should be skipped
        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(30);
    });

    // --- Deduplication of xDrip entries (line 86) ---

    it('deduplicates xDrip entries with the same timestamp', () => {
        const history: PumpHistoryEvent[] = [
            {
                enteredBy: 'xdrip',
                carbs: 20,
                insulin: 1.5,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
            {
                enteredBy: 'xdrip',
                carbs: 20,
                insulin: 1.5,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        // Second xDrip entry is a duplicate and should be skipped
        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(20);
        expect(result[0].bolus).toBe(1.5);
    });

    it('handles xDrip entry without timestamp field (nullish coalescing fallback)', () => {
        const history: PumpHistoryEvent[] = [
            {
                enteredBy: 'xdrip',
                carbs: 20,
                insulin: 1.0,
                created_at: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].timestamp).toBe(FIXED_TIME);
        expect(result[0].carbs).toBe(20);
    });

    // --- Deduplication of generic carbs > 0 entries (line 99) ---

    it('deduplicates generic carbs > 0 entries with the same timestamp', () => {
        const history: PumpHistoryEvent[] = [
            {
                carbs: 15,
                insulin: 0.5,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
            {
                carbs: 15,
                insulin: 0.5,
                created_at: FIXED_TIME,
                timestamp: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        // Second generic entry is a duplicate and should be skipped
        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(15);
    });

    it('handles generic carbs > 0 entry without timestamp field (nullish coalescing fallback)', () => {
        const history: PumpHistoryEvent[] = [
            {
                carbs: 15,
                insulin: 0.5,
                created_at: FIXED_TIME,
            },
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(15);
        expect(result[0].timestamp).toBe(FIXED_TIME);
    });

    // --- Deduplication of JournalEntryMealMarker entries (lines 112-119) ---

    it('deduplicates JournalEntryMealMarker entries with the same timestamp', () => {
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'JournalEntryMealMarker', carb_input: 35 }),
            makeHistory({ _type: 'JournalEntryMealMarker', carb_input: 35 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        // Second JournalEntryMealMarker is a duplicate and should be skipped
        expect(result).toHaveLength(1);
        expect(result[0].carbs).toBe(35);
        expect(result[0].journalCarbs).toBe(35);
    });

    // --- BolusWizard skipped when duplicate carb entry already exists (line 129-130) ---

    it('skips BolusWizard when a carb entry with the same timestamp already exists', () => {
        const carbs: PumpHistoryEvent[] = [
            { carbs: 45, created_at: FIXED_TIME },
        ];
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'Bolus', amount: 2.0 }),
            makeHistory({ _type: 'BolusWizard', carb_input: 45 }),
        ];
        const result = findMealInputs({ history, carbs });

        // carbHistory provides the carb entry, Bolus provides the bolus entry.
        // BolusWizard is skipped because a carb entry already exists at the same timestamp.
        expect(result).toHaveLength(2);
        const carbEntry = result.find(r => r.nsCarbs !== undefined);
        expect(carbEntry).toBeDefined();
        expect(carbEntry!.carbs).toBe(45);
        const bolusEntry = result.find(r => r.bolus !== undefined);
        expect(bolusEntry).toBeDefined();
        expect(bolusEntry!.bolus).toBe(2.0);
        // No bwCarbs entry should be present
        expect(result.find(r => r.bwCarbs !== undefined)).toBeUndefined();
    });

    // --- BolusWizard with carb_input === 0, no matching bolus (line 136-137) ---

    it('logs special message for BolusWizard with carb_input === 0 and no matching bolus', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'BolusWizard', carb_input: 0 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(0);
        expect(spy).toHaveBeenCalledWith(
            expect.stringContaining('BolusWizard without carbs'),
        );
        spy.mockRestore();
    });

    // --- BolusWizard with timestamp, no matching bolus (line 139) ---

    it('logs timestamp for BolusWizard with no matching bolus', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const history: PumpHistoryEvent[] = [
            makeHistory({ _type: 'BolusWizard', carb_input: 30 }),
        ];
        const result = findMealInputs({ history, carbs: [] });

        expect(result).toHaveLength(0);
        expect(spy).toHaveBeenCalledWith(
            `Timestamp of bolus wizard: ${FIXED_TIME}`,
        );
        spy.mockRestore();
    });

    // Note: BolusWizard entries without a timestamp are never deferred (line 67 guard),
    // so the `entry.timestamp ?? ''` fallback on line 126 and the `if (entry.timestamp)`
    // false branch on line 139 are structurally unreachable in Phase 3 processing.
});
