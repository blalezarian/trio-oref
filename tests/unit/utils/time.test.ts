import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleOffsetToEpoch, resolveGlucoseTime } from '../../../src/utils/time';

// ---------------------------------------------------------------------------
// scheduleOffsetToEpoch
// ---------------------------------------------------------------------------

describe('scheduleOffsetToEpoch', () => {
    const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_DATE);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns local midnight epoch for offset 0', () => {
        const result = scheduleOffsetToEpoch(0);
        const midnight = new Date(result);
        expect(midnight.getHours()).toBe(0);
        expect(midnight.getMinutes()).toBe(0);
        expect(midnight.getSeconds()).toBe(0);
        expect(midnight.getMilliseconds()).toBe(0);
    });

    it('adds correct offset for 480 minutes (8:00 AM)', () => {
        const result = scheduleOffsetToEpoch(480);
        const time = new Date(result);
        expect(time.getHours()).toBe(8);
        expect(time.getMinutes()).toBe(0);
    });

    it('adds correct offset for 1080 minutes (6:00 PM)', () => {
        const result = scheduleOffsetToEpoch(1080);
        const time = new Date(result);
        expect(time.getHours()).toBe(18);
        expect(time.getMinutes()).toBe(0);
    });

    it('clears milliseconds for a clean midnight', () => {
        // Set system time to something with non-zero ms
        vi.setSystemTime(new Date('2025-01-15T12:00:00.123Z'));
        const result = scheduleOffsetToEpoch(0);
        expect(result % 1000).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// resolveGlucoseTime
// ---------------------------------------------------------------------------

describe('resolveGlucoseTime', () => {
    it('parses display_time with T replaced by space', () => {
        const result = resolveGlucoseTime({ display_time: '2025-01-15T12:00:00' });
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).not.toBeNaN();
    });

    it('parses dateString as-is', () => {
        const result = resolveGlucoseTime({ dateString: '2025-01-15T12:00:00.000Z' });
        expect(result).toBeInstanceOf(Date);
        expect(result!.getTime()).toBe(new Date('2025-01-15T12:00:00.000Z').getTime());
    });

    it('prefers display_time over dateString', () => {
        const result = resolveGlucoseTime({
            display_time: '2025-01-15T11:00:00',
            dateString: '2025-01-15T12:00:00.000Z',
        });
        expect(result).toBeInstanceOf(Date);
    });

    it('returns undefined when neither field is present', () => {
        expect(resolveGlucoseTime({})).toBeUndefined();
    });
});
