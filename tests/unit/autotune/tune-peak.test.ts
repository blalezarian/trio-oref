import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tunePeakTime } from '../../../src/autotune/tune-peak';
import type { AutotunePeakDeviation } from '../../../src/autotune/types';

function makePeakDeviations(overrides: Partial<AutotunePeakDeviation>[] = []): AutotunePeakDeviation[] {
    const defaults: AutotunePeakDeviation[] = [
        { peak: 55, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { peak: 60, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { peak: 65, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 }, // index 2 = current
        { peak: 70, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { peak: 75, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
    ];
    return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

describe('tunePeakTime', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('returns currentPeak when peakDeviations is undefined', () => {
        expect(tunePeakTime(undefined, 75)).toBe(75);
    });

    it('returns currentPeak when peakDeviations[2] is missing', () => {
        const devs = [
            { peak: 55, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { peak: 60, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        ];
        expect(tunePeakTime(devs, 65)).toBe(65);
    });

    it('returns currentPeak when current (index 2) is optimal', () => {
        const devs = makePeakDeviations();
        expect(tunePeakTime(devs, 65)).toBe(65);
    });

    it('adjusts peak down when meanBest < 2 and RMSBest < 2', () => {
        const devs = makePeakDeviations([
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 4, RMSDeviation: 4 },
            { meanDeviation: 7, RMSDeviation: 8 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 11, RMSDeviation: 12 },
        ]);
        expect(tunePeakTime(devs, 65)).toBe(60); // peakDeviations[1].peak
    });

    it('adjusts peak up when meanBest > 2 and RMSBest > 2', () => {
        const devs = makePeakDeviations([
            { meanDeviation: 11, RMSDeviation: 12 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 7, RMSDeviation: 8 },
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 2, RMSDeviation: 2 },
        ]);
        expect(tunePeakTime(devs, 65)).toBe(70); // peakDeviations[3].peak
    });

    it('does not cap peak time (no MAX like DIA)', () => {
        // Peak can go as high as the data says — no max cap
        const devs = makePeakDeviations([
            { peak: 90, meanDeviation: 11, RMSDeviation: 12 },
            { peak: 95, meanDeviation: 9, RMSDeviation: 10 },
            { peak: 100, meanDeviation: 7, RMSDeviation: 8 },
            { peak: 105, meanDeviation: 3, RMSDeviation: 3 },
            { peak: 110, meanDeviation: 2, RMSDeviation: 2 },
        ]);
        expect(tunePeakTime(devs, 100)).toBe(105);
    });

    it('logs adjustment when peak changes', () => {
        const devs = makePeakDeviations([
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 4, RMSDeviation: 4 },
        ]);
        tunePeakTime(devs, 65);
        expect(console.error).toHaveBeenCalledWith(
            "Adjusting insulinPeakTime from 65 to 60 minutes",
        );
    });

    it('logs unchanged when peak stays the same (no unit suffix)', () => {
        const devs = makePeakDeviations();
        tunePeakTime(devs, 65);
        expect(console.error).toHaveBeenCalledWith(
            "Leaving insulinPeakTime unchanged at 65",
        );
    });
});
