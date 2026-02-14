import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insulinDosed } from '../../../src/autotunePrep/dosed';

const NOW = new Date('2025-01-15T12:00:00.000Z').getTime();

function makeOpts(
    treatments: Array<{ insulin?: number | null; date: number }> | undefined,
    startMinsAgo: number = 60,
    endMinsAgo: number = 0,
) {
    return {
        start: new Date(NOW - startMinsAgo * 60_000),
        end: new Date(NOW - endMinsAgo * 60_000),
        treatments,
        profile: {},
    };
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('insulinDosed', () => {
    // -----------------------------------------------------------------------
    // Null / empty guard
    // -----------------------------------------------------------------------

    it('returns empty object when treatments is undefined', () => {
        const result = insulinDosed(makeOpts(undefined));
        expect(result).toEqual({});
    });

    it('returns 0 insulin for empty treatments array', () => {
        const result = insulinDosed(makeOpts([]));
        expect(result).toEqual({ insulin: 0 });
    });

    // -----------------------------------------------------------------------
    // Basic summation
    // -----------------------------------------------------------------------

    it('sums insulin within time window', () => {
        const treatments = [
            { insulin: 2.5, date: NOW - 30 * 60_000 }, // 30m ago — in window
            { insulin: 1.5, date: NOW - 45 * 60_000 }, // 45m ago — in window
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 4 });
    });

    it('excludes treatments outside time window', () => {
        const treatments = [
            { insulin: 2.0, date: NOW - 30 * 60_000 }, // in window (60m ago to now)
            { insulin: 3.0, date: NOW - 90 * 60_000 }, // before window
            { insulin: 1.0, date: NOW + 10 * 60_000 },  // after window
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 2 });
    });

    it('excludes treatment exactly at start time (start exclusive)', () => {
        const treatments = [
            { insulin: 5.0, date: NOW - 60 * 60_000 }, // exactly at start
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 0 });
    });

    it('includes treatment exactly at end time (end inclusive)', () => {
        const treatments = [
            { insulin: 5.0, date: NOW }, // exactly at end
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 5 });
    });

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    it('skips treatments with null insulin', () => {
        const treatments = [
            { insulin: null, date: NOW - 30 * 60_000 },
            { insulin: 2.0, date: NOW - 15 * 60_000 },
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 2 });
    });

    it('skips treatments with undefined insulin', () => {
        const treatments = [
            { date: NOW - 30 * 60_000 }, // no insulin field
            { insulin: 3.0, date: NOW - 15 * 60_000 },
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 3 });
    });

    it('skips treatments with insulin = 0 (falsy)', () => {
        const treatments = [
            { insulin: 0, date: NOW - 30 * 60_000 },
            { insulin: 1.5, date: NOW - 15 * 60_000 },
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 1.5 });
    });

    it('rounds result to 3 decimal places', () => {
        const treatments = [
            { insulin: 1.1111, date: NOW - 30 * 60_000 },
            { insulin: 2.2222, date: NOW - 15 * 60_000 },
        ];
        const result = insulinDosed(makeOpts(treatments));
        expect(result).toEqual({ insulin: 3.333 });
    });
});
