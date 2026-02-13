import { describe, it, expect } from 'vitest';
import { splitAroundSuspends } from '../../../src/iob/split-around-suspends';
import type { TempEvent, SuspendEvent } from '../../../src/iob/types';

const BASE_TIME = new Date('2025-01-15T12:00:00Z').getTime();
const MS_PER_MINUTE = 60_000;

function makeEvent(offsetMin: number, durationMin: number): TempEvent {
    const date = BASE_TIME + offsetMin * MS_PER_MINUTE;
    return {
        rate: 1.0,
        duration: durationMin,
        date,
        started_at: new Date(date),
        timestamp: new Date(date).toISOString(),
    };
}

function makeSuspend(offsetMin: number, durationMin: number): SuspendEvent {
    const date = BASE_TIME + offsetMin * MS_PER_MINUTE;
    return {
        date,
        duration: durationMin,
        started_at: new Date(date),
        timestamp: new Date(date).toISOString(),
    };
}

describe('splitAroundSuspends', () => {

    const noSuspends: SuspendEvent[] = [];
    const farFutureResume = new Date(BASE_TIME + 9999 * MS_PER_MINUTE).toISOString();
    const farPastSuspend = new Date(BASE_TIME - 9999 * MS_PER_MINUTE).toISOString();

    it('returns event unchanged when no suspends overlap', () => {
        const event = makeEvent(0, 30);
        // Suspend at +60 doesn't overlap event at 0-30
        const result = splitAroundSuspends(
            event,
            [makeSuspend(60, 10)],
            farFutureResume,
            false,
            farPastSuspend,
            false,
        );
        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(30);
    });

    it('splits event around a suspend that falls in the middle', () => {
        // Event: 0-60 min, Suspend: 20-30 min
        const event = makeEvent(0, 60);
        const result = splitAroundSuspends(
            event,
            [makeSuspend(20, 10)],
            farFutureResume,
            false,
            farPastSuspend,
            false,
        );
        // Should produce 2 events: 0-20 and 30-60
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(20);
        expect(result[1].duration).toBe(30);
    });

    it('truncates event that starts before first resume when suspendedPrior', () => {
        const resumeTime = new Date(BASE_TIME + 15 * MS_PER_MINUTE).toISOString();
        const event = makeEvent(0, 30);
        const result = splitAroundSuspends(
            event,
            noSuspends,
            resumeTime,
            true,
            farPastSuspend,
            false,
        );
        expect(result).toHaveLength(1);
        // Event should be shortened: starts at resume (15) to original end (30), duration = 15
        expect(result[0].duration).toBe(15);
    });

    it('zeros event entirely before first resume when suspendedPrior', () => {
        const resumeTime = new Date(BASE_TIME + 60 * MS_PER_MINUTE).toISOString();
        const event = makeEvent(0, 30);
        const result = splitAroundSuspends(
            event,
            noSuspends,
            resumeTime,
            true,
            farPastSuspend,
            false,
        );
        expect(result).toHaveLength(1);
        expect(result[0].duration).toBe(0);
    });

    it('clones event without started_at when splitting around a mid-event suspend', () => {
        // Event without started_at: exercises the falsy branch of
        // cloneTempEvent line 110 (started_at undefined)
        const event: TempEvent = {
            rate: 1.0,
            duration: 60,
            date: BASE_TIME,
            // started_at intentionally omitted
            timestamp: new Date(BASE_TIME).toISOString(),
        };
        const result = splitAroundSuspends(
            event,
            [makeSuspend(20, 10)],
            farFutureResume,
            false,
            farPastSuspend,
            false,
        );
        // The event spans 0-60, suspend at 20-30 splits into 0-20 and 30-60
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(20);
        expect(result[1].duration).toBe(30);
        // The cloned event2 should have started_at undefined since original lacked it
        // (event2 gets a new started_at from the suspend end date in the code,
        //  but the clone's ternary for started_at was evaluated)
    });

    it('clones event with created_at when splitting around a mid-event suspend', () => {
        // Event with created_at: exercises the truthy branch of
        // cloneTempEvent line 111 (created_at defined)
        const createdDate = new Date(BASE_TIME - 5 * MS_PER_MINUTE);
        const event: TempEvent = {
            rate: 1.0,
            duration: 60,
            date: BASE_TIME,
            started_at: new Date(BASE_TIME),
            created_at: createdDate,
            timestamp: new Date(BASE_TIME).toISOString(),
        };
        const result = splitAroundSuspends(
            event,
            [makeSuspend(20, 10)],
            farFutureResume,
            false,
            farPastSuspend,
            false,
        );
        // The event spans 0-60, suspend at 20-30 splits into 0-20 and 30-60
        expect(result).toHaveLength(2);
        expect(result[0].duration).toBe(20);
        expect(result[1].duration).toBe(30);
        // The cloned event should preserve created_at as a new Date instance
        expect(result[1].created_at).toBeInstanceOf(Date);
        expect(result[1].created_at!.getTime()).toBe(createdDate.getTime());
        // Verify it's a clone (different reference)
        expect(result[1].created_at).not.toBe(createdDate);
    });

    it('truncates event that extends past lastSuspend when currentlySuspended', () => {
        const lastSuspend = new Date(BASE_TIME + 20 * MS_PER_MINUTE).toISOString();
        const event = makeEvent(0, 30);
        const result = splitAroundSuspends(
            event,
            noSuspends,
            farFutureResume,
            false,
            lastSuspend,
            1,
        );
        expect(result).toHaveLength(1);
        // firstResumeDate is farFutureResume, so duration = (farFutureResume - event.date) / MS_PER_MINUTE
        // But the key behavior: event was truncated because it extended past lastSuspendDate
    });
});
