import { describe, it, expect } from 'vitest';
import { splitTimespanWithOneSplitter, splitTimespan } from '../../../src/iob/split-at-basal-boundaries';
import type { TempEvent, SplitterEvent } from '../../../src/iob/types';

/** Create an event starting at a specific local-time hour:minute */
function makeEventAtLocalTime(hours: number, minutes: number, durationMin: number): TempEvent {
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return {
        rate: 1.0,
        duration: durationMin,
        date: d.getTime(),
        started_at: d,
        timestamp: d.toISOString(),
    };
}

function makeSplitter(minutes: number): SplitterEvent {
    return { type: 'recurring', minutes };
}

describe('splitTimespanWithOneSplitter', () => {

    it('returns event unchanged when no split is needed', () => {
        // Event from 10:00-10:20 (local), splitter at 11:00 (660 min) — no overlap
        const event = makeEventAtLocalTime(10, 0, 20);
        const result = splitTimespanWithOneSplitter(event, makeSplitter(660));
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(event);
    });

    it('splits event at basal boundary that falls within event duration', () => {
        // Event from 10:00-10:30 (local), splitter at 10:15 (615 min)
        const event = makeEventAtLocalTime(10, 0, 30);
        const result = splitTimespanWithOneSplitter(event, makeSplitter(615));
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(15);
        expect(result[1].duration).toBe(15);
    });

    it('splits long events (>30 min) at 30-minute mark', () => {
        // Event with duration > TEMP_BASAL_DURATION_MINUTES (30)
        const event = makeEventAtLocalTime(10, 0, 60);
        const result = splitTimespanWithOneSplitter(event, makeSplitter(0));
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(30);
        expect(result[1].duration).toBe(30);
    });

    it('preserves event2 date and timestamp after split', () => {
        const event = makeEventAtLocalTime(10, 0, 30);
        const result = splitTimespanWithOneSplitter(event, makeSplitter(615));
        expect(result).toHaveLength(2);
        // event2 should start 15 minutes after event1 start
        expect(result[1].date).toBeGreaterThan(result[0].date);
        expect(result[1].started_at).toBeInstanceOf(Date);
    });
});

describe('splitTimespan', () => {

    it('returns event unchanged when no splitters match', () => {
        // Event 10:00-10:20, splitter at 11:00 — no overlap
        const event = makeEventAtLocalTime(10, 0, 20);
        const result = splitTimespan(event, [makeSplitter(660)]);
        expect(result).toHaveLength(1);
    });

    it('splits event across multiple basal boundaries', () => {
        // Long event that will be split at 30-min chunks due to duration > 30
        const event = makeEventAtLocalTime(10, 0, 90);
        const result = splitTimespan(event, [makeSplitter(0)]);
        expect(result.length).toBeGreaterThan(1);
        // Total duration should be preserved
        const totalDuration = result.reduce((sum, e) => sum + e.duration!, 0);
        expect(totalDuration).toBe(90);
    });

    it('handles empty splitter array', () => {
        const event = makeEventAtLocalTime(10, 0, 20);
        const result = splitTimespan(event, []);
        expect(result).toHaveLength(1);
    });
});
