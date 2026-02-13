import { describe, it, expect, beforeEach } from 'vitest';
import {
    isfLookup,
    resetISFCache,
    ISF_LOOKUP_ERROR,
} from '../../../src/profile/isf';
import type { ISFData } from '../../../src/profile/isf';

/** Create a Date at a specific local hour:minute */
function localTime(hours: number, minutes: number = 0): Date {
    return new Date(2025, 0, 15, hours, minutes, 0, 0);
}

describe('isfLookup', () => {
    // Reset the module-level cache before each test
    beforeEach(() => {
        resetISFCache();
    });

    const isfData: ISFData = {
        sensitivities: [
            { offset: 0, sensitivity: 50 },
            { offset: 360, sensitivity: 45 },
            { offset: 720, sensitivity: 40 },
        ],
    };

    it('returns the correct sensitivity for early morning', () => {
        // 2:00 AM = 120 minutes → first entry (0–360)
        expect(isfLookup(isfData, localTime(2, 0))).toBe(50);
    });

    it('returns the correct sensitivity for mid-day', () => {
        // 8:00 AM = 480 minutes → second entry (360–720)
        expect(isfLookup(isfData, localTime(8, 0))).toBe(45);
    });

    it('returns the last entry for times beyond all offsets', () => {
        // 2:00 PM = 840 minutes → falls in last entry (>= 720)
        expect(isfLookup(isfData, localTime(14, 0))).toBe(40);
    });

    it('returns ISF_LOOKUP_ERROR when first entry offset is not 0', () => {
        const badData: ISFData = {
            sensitivities: [
                { offset: 60, sensitivity: 50 },
                { offset: 360, sensitivity: 45 },
            ],
        };
        expect(isfLookup(badData, localTime(12, 0))).toBe(ISF_LOOKUP_ERROR);
    });

    it('handles single-entry schedule', () => {
        const singleEntry: ISFData = {
            sensitivities: [{ offset: 0, sensitivity: 55 }],
        };
        expect(isfLookup(singleEntry, localTime(12, 0))).toBe(55);
    });

    it('uses cache on consecutive calls in same time window', () => {
        // First call populates the cache
        expect(isfLookup(isfData, localTime(2, 0))).toBe(50);
        // Second call in same window should hit cache
        expect(isfLookup(isfData, localTime(2, 30))).toBe(50);
    });

    it('sorts unsorted sensitivities before lookup', () => {
        const unsorted: ISFData = {
            sensitivities: [
                { offset: 720, sensitivity: 40 },
                { offset: 0, sensitivity: 50 },
                { offset: 360, sensitivity: 45 },
            ],
        };
        expect(isfLookup(unsorted, localTime(8, 0))).toBe(45);
    });

    it('returns boundary sensitivity correctly', () => {
        // Exactly at 360 minutes (6:00 AM) → second entry
        expect(isfLookup(isfData, localTime(6, 0))).toBe(45);
    });

    it('re-resolves when cached range no longer covers the current time', () => {
        // First call at 2:00 AM → caches entry 0 (offset 0, endOffset 360)
        expect(isfLookup(isfData, localTime(2, 0))).toBe(50);
        // Second call at 8:00 AM → 480 minutes, outside [0, 360) → cache miss, re-resolves
        resetISFCache();  // reset to cleanly verify the miss path
        expect(isfLookup(isfData, localTime(2, 0))).toBe(50);
        // Now call at 8:00 AM — cache says [0, 360) but 480 >= 360, so miss
        expect(isfLookup(isfData, localTime(8, 0))).toBe(45);
    });

    it('misses cache when nowMinutes is before cached range start', () => {
        // Populate cache with entry at 8:00 AM (offset 360-720)
        expect(isfLookup(isfData, localTime(8, 0))).toBe(45);
        // Now call at 2:00 AM — 120 < 360 (cached offset), cache miss
        expect(isfLookup(isfData, localTime(2, 0))).toBe(50);
    });
});
