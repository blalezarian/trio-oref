import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    wasAlreadyProcessed,
    findRelatedEvents,
    finalizeBolusGroup,
    processBolusGroup,
    reduceBoluses,
} from '../../src/bolus/index';
import type { BolusTreatment } from '../../src/bolus/index';
import type { PumpHistoryEvent } from '../../src/types/index';

// ---------------------------------------------------------------------------
// wasAlreadyProcessed
// ---------------------------------------------------------------------------

describe('wasAlreadyProcessed', () => {
    const event: BolusTreatment = {
        _type: 'Bolus',
        timestamp: '2025-01-15T12:00:00.000Z',
    };

    it('returns false when processedEvents is empty', () => {
        expect(wasAlreadyProcessed(event, [])).toBe(false);
    });

    it('returns true when matching timestamp and _type exist', () => {
        const processed = [{ ...event }];
        expect(wasAlreadyProcessed(event, processed)).toBe(true);
    });

    it('returns false when timestamp differs', () => {
        const processed = [{ ...event, timestamp: '2025-01-15T13:00:00.000Z' }];
        expect(wasAlreadyProcessed(event, processed)).toBe(false);
    });

    it('returns false when _type differs', () => {
        const processed = [{ ...event, _type: 'BolusWizard' as const }];
        expect(wasAlreadyProcessed(event, processed)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// findRelatedEvents
// ---------------------------------------------------------------------------

describe('findRelatedEvents', () => {
    const origin: BolusTreatment = {
        _type: 'Bolus',
        timestamp: '2025-01-15T12:00:00.000Z',
    };

    it('returns events within the time window', () => {
        const candidates: BolusTreatment[] = [
            { _type: 'BolusWizard', timestamp: '2025-01-15T11:59:00.000Z' },
        ];
        const result = findRelatedEvents(origin, candidates, 2);
        expect(result).toHaveLength(1);
    });

    it('excludes events outside the time window', () => {
        const candidates: BolusTreatment[] = [
            { _type: 'BolusWizard', timestamp: '2025-01-15T11:55:00.000Z' },
        ];
        const result = findRelatedEvents(origin, candidates, 2);
        expect(result).toHaveLength(0);
    });

    it('includes events after origin (negative delta)', () => {
        const candidates: BolusTreatment[] = [
            { _type: 'BolusWizard', timestamp: '2025-01-15T12:01:00.000Z' },
        ];
        const result = findRelatedEvents(origin, candidates, 2);
        expect(result).toHaveLength(1);
    });

    it('does not mutate the original candidates array', () => {
        const candidates: BolusTreatment[] = [
            { _type: 'Bolus', timestamp: '2025-01-15T11:59:00.000Z' },
        ];
        const original = [...candidates];
        findRelatedEvents(origin, candidates, 2);
        expect(candidates).toEqual(original);
    });
});

// ---------------------------------------------------------------------------
// finalizeBolusGroup
// ---------------------------------------------------------------------------

describe('finalizeBolusGroup', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('sets eventType to <none> when no carbs and no insulin', () => {
        const result = finalizeBolusGroup({});
        expect(result.eventType).toBe('<none>');
    });

    it('classifies Meal Bolus when both carbs and insulin', () => {
        const result = finalizeBolusGroup({
            carbs: '45',
            bolus: { amount: 3 } as PumpHistoryEvent,
        });
        expect(result.eventType).toBe('Meal Bolus');
    });

    it('classifies Carb Correction when carbs but no insulin', () => {
        const result = finalizeBolusGroup({
            carbs: '30',
        });
        expect(result.eventType).toBe('Carb Correction');
    });

    it('classifies Correction Bolus when insulin but no carbs', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 2 } as PumpHistoryEvent,
        });
        expect(result.eventType).toBe('Correction Bolus');
    });

    it('converts insulin to string when > 0', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 5 } as PumpHistoryEvent,
        });
        expect(result.insulin).toBe('5');
    });

    it('stores insulin as number 0 when no insulin (preserves original)', () => {
        const result = finalizeBolusGroup({});
        expect(result.insulin).toBe(0);
    });

    it('sums square and bolus amounts', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 3 } as PumpHistoryEvent,
            square: { amount: 2, duration: 30 } as PumpHistoryEvent,
        });
        expect(result.insulin).toBe('5');
    });

    it('annotates DualWave when both square and bolus', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 3 } as PumpHistoryEvent,
            square: { amount: 2, duration: 30 } as PumpHistoryEvent,
        });
        expect(result.notes).toContain('DualWave bolus for');
    });

    it('annotates Normal bolus with wizard', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 3 } as PumpHistoryEvent,
            wizard: { timestamp: '2025-01-15T12:00:00.000Z' } as PumpHistoryEvent,
        });
        expect(result.notes).toContain('Normal bolus with wizard.');
    });

    it('annotates delivery percentages', () => {
        const result = finalizeBolusGroup({
            bolus: { amount: 4, programmed: 5 } as PumpHistoryEvent,
        });
        expect(result.notes).toContain('Percent delivered:');
        expect(result.notes).toContain('80%');
    });

    it('sets created_at from wizard timestamp', () => {
        const result = finalizeBolusGroup({
            wizard: {
                timestamp: '2025-01-15T10:00:00.000Z',
                sensitivity: 40,
            } as PumpHistoryEvent,
        });
        expect(result.created_at).toBe('2025-01-15T10:00:00.000Z');
    });
});

// ---------------------------------------------------------------------------
// processBolusGroup
// ---------------------------------------------------------------------------

describe('processBolusGroup', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('processes a BolusWizard event', () => {
        const events: PumpHistoryEvent[] = [{
            _type: 'BolusWizard',
            timestamp: '2025-01-15T12:00:00.000Z',
            carb_input: 45,
            carb_ratio: 10,
            bg: 150,
        }];
        const processed: BolusTreatment[] = [];
        const result = processBolusGroup(events, processed);
        expect(result.carbs).toBe('45');
        expect(result.ratio).toBe('10');
        expect(result.bg).toBe('150');
        expect(processed).toHaveLength(1);
    });

    it('processes a Bolus event', () => {
        const events: PumpHistoryEvent[] = [{
            _type: 'Bolus',
            timestamp: '2025-01-15T12:00:00.000Z',
            amount: 3,
            programmed: 3,
            duration: 0,
        }];
        const processed: BolusTreatment[] = [];
        const result = processBolusGroup(events, processed);
        expect(result.insulin).toBe('3');
        expect(processed).toHaveLength(1);
    });

    it('stops processing when both wizard and bolus found', () => {
        const events: PumpHistoryEvent[] = [
            {
                _type: 'BolusWizard',
                timestamp: '2025-01-15T12:00:00.000Z',
                carb_input: 30,
                carb_ratio: 10,
            },
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:30.000Z',
                amount: 3,
                programmed: 3,
                duration: 0,
            },
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:01:00.000Z',
                amount: 1,
                programmed: 1,
                duration: 0,
            },
        ];
        const processed: BolusTreatment[] = [];
        processBolusGroup(events, processed);
        // Third event should NOT be processed
        expect(processed).toHaveLength(2);
    });

    it('accumulates multiple Bolus amounts', () => {
        const events: PumpHistoryEvent[] = [
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:00.000Z',
                amount: 3,
                programmed: 3,
                duration: 0,
            },
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:30.000Z',
                amount: 2,
                programmed: 2,
                duration: 0,
            },
        ];
        const processed: BolusTreatment[] = [];
        const result = processBolusGroup(events, processed);
        expect(result.insulin).toBe('5');
    });

    it('breaks and logs when encountering a null/undefined event in the group', () => {
        // Lines 244-246: if (!event) → log and break
        const events: PumpHistoryEvent[] = [
            null as unknown as PumpHistoryEvent, // falsy event
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:00.000Z',
                amount: 3,
                programmed: 3,
                duration: 0,
            },
        ];
        const processed: BolusTreatment[] = [];
        const result = processBolusGroup(events, processed);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining('XXX'),
        );
        // After break, finalize with empty accumulator
        expect(result.eventType).toBe('<none>');
    });

    it('assigns square bolus for non-zero duration', () => {
        const events: PumpHistoryEvent[] = [{
            _type: 'Bolus',
            timestamp: '2025-01-15T12:00:00.000Z',
            amount: 2,
            programmed: 2,
            duration: 30,
        }];
        const processed: BolusTreatment[] = [];
        const result = processBolusGroup(events, processed);
        expect(result.notes).toContain('Solo Square wave bolus for');
    });
});

// ---------------------------------------------------------------------------
// reduceBoluses
// ---------------------------------------------------------------------------

describe('reduceBoluses', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('returns empty array for empty input', () => {
        expect(reduceBoluses([])).toEqual([]);
    });

    it('passes through non-bolus events', () => {
        const treatments: BolusTreatment[] = [
            { _type: 'TempBasal', timestamp: '2025-01-15T12:00:00.000Z' },
        ];
        const results = reduceBoluses(treatments);
        expect(results).toHaveLength(1);
        expect(results[0]._type).toBe('TempBasal');
    });

    it('handles JournalEntryMealMarker', () => {
        const treatments: BolusTreatment[] = [
            {
                _type: 'JournalEntryMealMarker',
                timestamp: '2025-01-15T12:00:00.000Z',
                carb_input: '25',
            },
        ];
        const results = reduceBoluses(treatments);
        expect(results[0].eventType).toBe('Carb Correction');
        expect(results[0].carbs).toBe('25');
    });

    it('groups related Bolus and BolusWizard events', () => {
        const treatments: BolusTreatment[] = [
            {
                _type: 'BolusWizard',
                timestamp: '2025-01-15T12:00:00.000Z',
                carb_input: 45,
                carb_ratio: 10,
            },
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:30.000Z',
                amount: 4.5,
                programmed: 4.5,
                duration: 0,
            },
        ];
        const results = reduceBoluses(treatments);
        expect(results).toHaveLength(1);
        expect(results[0].eventType).toBe('Meal Bolus');
    });

    it('skips already-processed events', () => {
        const treatments: BolusTreatment[] = [
            {
                _type: 'BolusWizard',
                timestamp: '2025-01-15T12:00:00.000Z',
                carb_input: 45,
                carb_ratio: 10,
            },
            {
                _type: 'Bolus',
                timestamp: '2025-01-15T12:00:30.000Z',
                amount: 4.5,
                programmed: 4.5,
                duration: 0,
            },
        ];
        const results = reduceBoluses(treatments);
        // Bolus was grouped with BolusWizard, not processed separately
        expect(results).toHaveLength(1);
    });
});
