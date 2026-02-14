import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    determineSiteChangeTime,
    resolveLastBgTime,
} from '../../../src/autosens/prepareData';
import type { GlucoseEntry } from '../../../src/types/index';

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();

// ---------------------------------------------------------------------------
// determineSiteChangeTime
// ---------------------------------------------------------------------------

describe('determineSiteChangeTime', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    const glucose = [{ date: NOW }] as GlucoseEntry[];

    it('retrospective mode: uses glucose_data[0].date minus 24h', () => {
        const result = determineSiteChangeTime(glucose, true, [], undefined);
        const expected = NOW - 24 * 3_600_000;
        expect(result.getTime()).toBe(expected);
    });

    it('non-retrospective mode: uses current time minus 24h', () => {
        const before = Date.now() - 24 * 3_600_000;
        const result = determineSiteChangeTime(glucose, false, [], undefined);
        const after = Date.now() - 24 * 3_600_000;
        // Should be between before and after (close to now - 24h)
        expect(result.getTime()).toBeGreaterThanOrEqual(before);
        expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('rewindResetsAutosens: false returns default 24h lookback', () => {
        const result = determineSiteChangeTime(glucose, true, [], false);
        expect(result.getTime()).toBe(NOW - 24 * 3_600_000);
    });

    it('rewindResetsAutosens: true with Rewind event uses rewind timestamp', () => {
        const rewindTime = new Date(NOW - 2 * 3_600_000).toISOString();
        const history = [
            { _type: 'Bolus', timestamp: FIXED_TIME } as any,
            { _type: 'Rewind', timestamp: rewindTime } as any,
        ];
        const result = determineSiteChangeTime(glucose, true, history, true);
        expect(result.getTime()).toBe(new Date(rewindTime).getTime());
    });

    it('rewindResetsAutosens: true without Rewind event keeps 24h default', () => {
        const history = [
            { _type: 'Bolus', timestamp: FIXED_TIME } as any,
            { _type: 'TempBasal', timestamp: FIXED_TIME } as any,
        ];
        const result = determineSiteChangeTime(glucose, true, history, true);
        expect(result.getTime()).toBe(NOW - 24 * 3_600_000);
    });

    it('skips history[0] (loop starts at h=1)', () => {
        const rewindTime = new Date(NOW - 1 * 3_600_000).toISOString();
        const history = [
            { _type: 'Rewind', timestamp: rewindTime } as any, // index 0, should be skipped
        ];
        const result = determineSiteChangeTime(glucose, true, history, true);
        // Rewind at index 0 is skipped, so default 24h lookback
        expect(result.getTime()).toBe(NOW - 24 * 3_600_000);
    });

    it('skips Rewind event without timestamp', () => {
        const history = [
            { _type: 'Bolus', timestamp: FIXED_TIME } as any,
            { _type: 'Rewind' } as any, // no timestamp
        ];
        const result = determineSiteChangeTime(glucose, true, history, true);
        expect(result.getTime()).toBe(NOW - 24 * 3_600_000);
    });
});

// ---------------------------------------------------------------------------
// resolveLastBgTime
// ---------------------------------------------------------------------------

describe('resolveLastBgTime', () => {
    const emptyBucket = {} as GlucoseEntry;

    it('returns Date from prevEntry.display_time when present', () => {
        const prev = { display_time: '2025-01-15T11:00:00' } as GlucoseEntry;
        const result = resolveLastBgTime(prev, emptyBucket);
        expect(result).toBeInstanceOf(Date);
        expect((result as Date).getTime()).not.toBeNaN();
    });

    it('returns Date from prevEntry.dateString when no display_time', () => {
        const prev = { dateString: '2025-01-15T11:00:00.000Z' } as GlucoseEntry;
        const result = resolveLastBgTime(prev, emptyBucket);
        expect(result).toBeInstanceOf(Date);
        expect((result as Date).getTime()).toBe(new Date('2025-01-15T11:00:00.000Z').getTime());
    });

    it('falls back to firstBucket.display_time when prevEntry has no time fields', () => {
        const prev = {} as GlucoseEntry;
        const bucket = { display_time: '2025-01-15T10:00:00' } as GlucoseEntry;
        const result = resolveLastBgTime(prev, bucket);
        expect(result).toBeInstanceOf(Date);
    });

    it('returns "skip" when prevEntry has only xDrip_started_at', () => {
        const prev = { xDrip_started_at: '2025-01-15T10:00:00' } as GlucoseEntry;
        expect(resolveLastBgTime(prev, emptyBucket)).toBe('skip');
    });

    it('returns undefined when no time source is available', () => {
        const prev = {} as GlucoseEntry;
        expect(resolveLastBgTime(prev, emptyBucket)).toBeUndefined();
    });

    it('prefers prevEntry over firstBucket', () => {
        const prev = { dateString: '2025-01-15T11:00:00.000Z' } as GlucoseEntry;
        const bucket = { display_time: '2025-01-15T10:00:00' } as GlucoseEntry;
        const result = resolveLastBgTime(prev, bucket);
        expect((result as Date).getTime()).toBe(new Date('2025-01-15T11:00:00.000Z').getTime());
    });

    it('falls back to firstBucket display_time when prevEntry.display_time has no T', () => {
        // prevEntry has no time fields, firstBucket has display_time
        const prev = {} as GlucoseEntry;
        const bucket = { display_time: '2025-01-15 10:00:00' } as GlucoseEntry;
        const result = resolveLastBgTime(prev, bucket);
        expect(result).toBeInstanceOf(Date);
        expect((result as Date).getTime()).not.toBeNaN();
    });
});
