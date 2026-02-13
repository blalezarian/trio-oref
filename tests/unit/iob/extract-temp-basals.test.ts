import { describe, it, expect } from 'vitest';
import { extractTempBasalsAndBoluses } from '../../../src/iob/extract-temp-basals';
import type { PumpHistoryEvent } from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME);

function makeBolusEvent(timestamp: string, amount: number): PumpHistoryEvent {
    return {
        _type: 'Bolus',
        timestamp,
        amount,
    } as PumpHistoryEvent;
}

function makeTempBasalEvent(timestamp: string, rate: number, durationMin: number): PumpHistoryEvent[] {
    return [
        {
            _type: 'TempBasalDuration',
            timestamp,
            'duration (min)': durationMin,
        } as unknown as PumpHistoryEvent,
        {
            _type: 'TempBasal',
            timestamp,
            rate,
            temp: 'absolute',
        } as PumpHistoryEvent,
    ];
}

describe('extractTempBasalsAndBoluses', () => {

    it('returns empty arrays for empty pump history', () => {
        const result = extractTempBasalsAndBoluses([], NOW);
        expect(result.tempHistory).toEqual([]);
        expect(result.tempBoluses).toEqual([]);
    });

    it('extracts a Bolus event into tempBoluses', () => {
        const events = [makeBolusEvent('2025-01-15T11:30:00.000Z', 2.5)];
        const result = extractTempBasalsAndBoluses(events, NOW);
        expect(result.tempBoluses).toHaveLength(1);
        expect(result.tempBoluses[0].insulin).toBe(2.5);
    });

    it('extracts a TempBasal+TempBasalDuration pair into tempHistory', () => {
        const events = makeTempBasalEvent('2025-01-15T11:00:00.000Z', 1.5, 30);
        const result = extractTempBasalsAndBoluses(events, NOW);
        // tempHistory includes the event + a cancel temp for each history entry
        const tempBasals = result.tempHistory.filter(t => t.rate !== 0 || t.duration !== 0);
        expect(tempBasals.length).toBeGreaterThanOrEqual(1);
        expect(tempBasals[0].rate).toBe(1.5);
        expect(tempBasals[0].duration).toBe(30);
    });

    it('skips TempBasal with percent type', () => {
        const events: PumpHistoryEvent[] = [{
            _type: 'TempBasal',
            timestamp: '2025-01-15T11:00:00.000Z',
            rate: 50,
            temp: 'percent',
        } as PumpHistoryEvent];
        const result = extractTempBasalsAndBoluses(events, NOW);
        // Should only have cancel temps, no real temp basals
        const nonCancel = result.tempHistory.filter(t => t.rate !== 0 || t.duration !== 0);
        expect(nonCancel).toHaveLength(0);
    });

    it('adds cancel temp with zeroTempDuration when provided', () => {
        const events = [makeBolusEvent('2025-01-15T11:30:00.000Z', 1.0)];
        const result = extractTempBasalsAndBoluses(events, NOW, 240);
        const cancelTemps = result.tempHistory.filter(t => t.rate === 0 && t.duration === 240);
        expect(cancelTemps.length).toBeGreaterThanOrEqual(1);
    });

    it('adds cancel temp with duration=0 when zeroTempDuration not provided', () => {
        const events = [makeBolusEvent('2025-01-15T11:30:00.000Z', 1.0)];
        const result = extractTempBasalsAndBoluses(events, NOW);
        const cancelTemps = result.tempHistory.filter(t => t.rate === 0 && t.duration === 0);
        expect(cancelTemps.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts Nightscout Care Portal Meal Bolus', () => {
        const events: PumpHistoryEvent[] = [{
            eventType: 'Meal Bolus',
            created_at: '2025-01-15T11:00:00.000Z',
            insulin: 3.0,
        } as PumpHistoryEvent];
        const result = extractTempBasalsAndBoluses(events, NOW);
        expect(result.tempBoluses).toHaveLength(1);
        expect(result.tempBoluses[0].insulin).toBe(3.0);
    });

    it('ignores out-of-order records (deduplication)', () => {
        // Second event has a later timestamp than first — should be skipped
        const events: PumpHistoryEvent[] = [
            makeBolusEvent('2025-01-15T11:00:00.000Z', 1.0),
            makeBolusEvent('2025-01-15T11:30:00.000Z', 2.0), // out of order (later)
        ];
        const result = extractTempBasalsAndBoluses(events, NOW);
        // Only the first bolus should be extracted
        expect(result.tempBoluses).toHaveLength(1);
        expect(result.tempBoluses[0].insulin).toBe(1.0);
    });
});
