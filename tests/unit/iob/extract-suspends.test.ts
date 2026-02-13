import { describe, it, expect } from 'vitest';
import { extractSuspendResumeData } from '../../../src/iob/extract-suspends';
import type { PumpHistoryEvent } from '../../../src/types/index';
import type { SuspendResumeData } from '../../../src/iob/types';

const MS_PER_MINUTE = 60_000;

describe('extractSuspendResumeData', () => {
    // -----------------------------------------------------------------------
    // Empty / no suspend-resume events
    // -----------------------------------------------------------------------

    it('returns empty pumpSuspends for history with no suspend/resume events', () => {
        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus', timestamp: '2025-01-15T12:00:00.000Z', amount: 2.0 },
            { _type: 'TempBasal', timestamp: '2025-01-15T12:05:00.000Z', rate: 1.5 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.pumpSuspends).toEqual([]);
        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
    });

    it('returns empty pumpSuspends for an empty history array', () => {
        const result = extractSuspendResumeData([]);

        expect(result.pumpSuspends).toEqual([]);
        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Single suspend/resume pair
    // -----------------------------------------------------------------------

    it('pairs a single suspend with a single resume, computing duration in minutes', () => {
        const suspendTime = '2025-01-15T12:00:00.000Z';
        const resumeTime = '2025-01-15T12:30:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: suspendTime },
            { _type: 'PumpResume', timestamp: resumeTime },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.pumpSuspends).toHaveLength(1);

        const suspendMs = new Date(suspendTime).getTime();
        const resumeMs = new Date(resumeTime).getTime();
        const expectedDuration = (resumeMs - suspendMs) / MS_PER_MINUTE;

        expect(result.pumpSuspends[0].duration).toBe(expectedDuration);
        expect(result.pumpSuspends[0].duration).toBe(30);
        expect(result.pumpSuspends[0].date).toBe(suspendMs);
        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
    });

    // -----------------------------------------------------------------------
    // suspendedPrior detection
    // -----------------------------------------------------------------------

    it('sets suspendedPrior=true when first resume is before first suspend', () => {
        // A resume appearing before any suspend means the pump was already
        // suspended before the history window started.
        const resumeTime = '2025-01-15T12:00:00.000Z';
        const suspendTime = '2025-01-15T12:30:00.000Z';
        const secondResumeTime = '2025-01-15T13:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpResume', timestamp: resumeTime },
            { _type: 'PumpSuspend', timestamp: suspendTime },
            { _type: 'PumpResume', timestamp: secondResumeTime },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.suspendedPrior).toBe(true);
        expect(result.firstResumeTime).toBe(resumeTime);
    });

    it('sets suspendedPrior=true when there are resumes but no suspends at all', () => {
        const resumeTime = '2025-01-15T12:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpResume', timestamp: resumeTime },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.suspendedPrior).toBe(true);
        expect(result.firstResumeTime).toBe(resumeTime);
        expect(result.pumpSuspends).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // currentlySuspended detection
    // -----------------------------------------------------------------------

    it('sets currentlySuspended=1 when last suspend has no matching resume', () => {
        const suspendTime = '2025-01-15T12:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: suspendTime },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.currentlySuspended).toBe(1);
        expect(result.lastSuspendTime).toBe(suspendTime);
        // The suspend should still be in the array (though without duration)
        expect(result.pumpSuspends).toHaveLength(1);
        expect(result.pumpSuspends[0].date).toBe(new Date(suspendTime).getTime());
    });

    it('sets currentlySuspended=1 when there are more suspends than resumes', () => {
        const suspendTime1 = '2025-01-15T12:00:00.000Z';
        const resumeTime1 = '2025-01-15T12:30:00.000Z';
        const suspendTime2 = '2025-01-15T13:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: suspendTime1 },
            { _type: 'PumpResume', timestamp: resumeTime1 },
            { _type: 'PumpSuspend', timestamp: suspendTime2 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.currentlySuspended).toBe(1);
        expect(result.lastSuspendTime).toBe(suspendTime2);
        // First suspend gets a duration, second does not (no matching resume)
        expect(result.pumpSuspends).toHaveLength(2);
        expect(result.pumpSuspends[0].duration).toBe(30);
        expect(result.pumpSuspends[1].duration).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Sorting
    // -----------------------------------------------------------------------

    it('returns sorted suspends and resumes (by date) regardless of input order', () => {
        // Provide events in reverse chronological order
        const earlyS = '2025-01-15T10:00:00.000Z';
        const earlyR = '2025-01-15T10:15:00.000Z';
        const lateS = '2025-01-15T14:00:00.000Z';
        const lateR = '2025-01-15T14:45:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: lateS },
            { _type: 'PumpResume', timestamp: lateR },
            { _type: 'PumpSuspend', timestamp: earlyS },
            { _type: 'PumpResume', timestamp: earlyR },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.pumpSuspends).toHaveLength(2);

        // Suspends should be sorted chronologically
        expect(result.pumpSuspends[0].date).toBe(new Date(earlyS).getTime());
        expect(result.pumpSuspends[1].date).toBe(new Date(lateS).getTime());

        // Durations should be correctly matched after sorting
        expect(result.pumpSuspends[0].duration).toBe(15); // 15 min
        expect(result.pumpSuspends[1].duration).toBe(45); // 45 min

        expect(result.firstResumeTime).toBe(earlyR);
        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Multiple suspend/resume pairs
    // -----------------------------------------------------------------------

    it('handles multiple suspend/resume pairs with correct durations', () => {
        const s1 = '2025-01-15T08:00:00.000Z';
        const r1 = '2025-01-15T08:20:00.000Z';
        const s2 = '2025-01-15T10:00:00.000Z';
        const r2 = '2025-01-15T10:10:00.000Z';
        const s3 = '2025-01-15T14:00:00.000Z';
        const r3 = '2025-01-15T15:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: s1 },
            { _type: 'PumpResume', timestamp: r1 },
            { _type: 'PumpSuspend', timestamp: s2 },
            { _type: 'PumpResume', timestamp: r2 },
            { _type: 'PumpSuspend', timestamp: s3 },
            { _type: 'PumpResume', timestamp: r3 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.pumpSuspends).toHaveLength(3);
        expect(result.pumpSuspends[0].duration).toBe(20);  // 08:00 -> 08:20
        expect(result.pumpSuspends[1].duration).toBe(10);  // 10:00 -> 10:10
        expect(result.pumpSuspends[2].duration).toBe(60);  // 14:00 -> 15:00

        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
        expect(result.firstResumeTime).toBe(r1);
    });

    // -----------------------------------------------------------------------
    // Both suspendedPrior and currentlySuspended
    // -----------------------------------------------------------------------

    it('sets both suspendedPrior and currentlySuspended when applicable', () => {
        // Resume before any suspend (suspended prior) + trailing suspend (currently suspended)
        const r0 = '2025-01-15T08:00:00.000Z';
        const s1 = '2025-01-15T10:00:00.000Z';
        const r1 = '2025-01-15T10:30:00.000Z';
        const s2 = '2025-01-15T12:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpResume', timestamp: r0 },
            { _type: 'PumpSuspend', timestamp: s1 },
            { _type: 'PumpResume', timestamp: r1 },
            { _type: 'PumpSuspend', timestamp: s2 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.suspendedPrior).toBe(true);
        expect(result.currentlySuspended).toBe(1);
        expect(result.firstResumeTime).toBe(r0);
        expect(result.lastSuspendTime).toBe(s2);
    });

    // -----------------------------------------------------------------------
    // Non-suspend/resume events are ignored
    // -----------------------------------------------------------------------

    it('ignores non-suspend/resume events interspersed in the history', () => {
        const suspendTime = '2025-01-15T12:00:00.000Z';
        const resumeTime = '2025-01-15T12:15:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'Bolus', timestamp: '2025-01-15T11:50:00.000Z', amount: 3.0 },
            { _type: 'PumpSuspend', timestamp: suspendTime },
            { _type: 'TempBasal', timestamp: '2025-01-15T12:05:00.000Z', rate: 0 },
            { _type: 'PumpResume', timestamp: resumeTime },
            { _type: 'Bolus', timestamp: '2025-01-15T12:30:00.000Z', amount: 1.5 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.pumpSuspends).toHaveLength(1);
        expect(result.pumpSuspends[0].duration).toBe(15);
        expect(result.suspendedPrior).toBe(false);
        expect(result.currentlySuspended).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Epoch date values
    // -----------------------------------------------------------------------

    it('populates date and started_at fields from the timestamp', () => {
        const suspendTime = '2025-01-15T12:00:00.000Z';
        const resumeTime = '2025-01-15T12:05:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: suspendTime },
            { _type: 'PumpResume', timestamp: resumeTime },
        ];

        const result = extractSuspendResumeData(history);

        const expectedDate = new Date(suspendTime).getTime();
        expect(result.pumpSuspends[0].date).toBe(expectedDate);
        expect(result.pumpSuspends[0].started_at).toEqual(new Date(expectedDate));
    });

    // -----------------------------------------------------------------------
    // Truncation of extra suspends
    // -----------------------------------------------------------------------

    it('truncates extra suspends after reaching an unmatched suspend', () => {
        // Two suspends, one resume -- the second suspend triggers currentlySuspended,
        // and any subsequent suspend (third) should be truncated.
        const s1 = '2025-01-15T10:00:00.000Z';
        const r1 = '2025-01-15T10:30:00.000Z';
        const s2 = '2025-01-15T11:00:00.000Z';
        const s3 = '2025-01-15T12:00:00.000Z';

        const history: PumpHistoryEvent[] = [
            { _type: 'PumpSuspend', timestamp: s1 },
            { _type: 'PumpResume', timestamp: r1 },
            { _type: 'PumpSuspend', timestamp: s2 },
            { _type: 'PumpSuspend', timestamp: s3 },
        ];

        const result = extractSuspendResumeData(history);

        expect(result.currentlySuspended).toBe(1);
        expect(result.lastSuspendTime).toBe(s2);
        // The third suspend (s3) should have been truncated
        expect(result.pumpSuspends).toHaveLength(2);
    });
});
