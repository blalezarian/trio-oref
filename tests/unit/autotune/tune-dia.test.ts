import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tuneDIA } from '../../../src/autotune/tune-dia';
import type { AutotuneDiaDeviation } from '../../../src/autotune/types';

function makeDiaDeviations(overrides: Partial<AutotuneDiaDeviation>[] = []): AutotuneDiaDeviation[] {
    const defaults: AutotuneDiaDeviation[] = [
        { dia: 3, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 4, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 5, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 }, // index 2 = current
        { dia: 6, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
        { dia: 7, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
    ];
    return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
}

describe('tuneDIA', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('returns currentDIA when diaDeviations is undefined', () => {
        expect(tuneDIA(undefined, 5)).toBe(5);
    });

    it('returns currentDIA when current (index 2) is optimal', () => {
        // All deviations equal — neither lower nor higher is better
        const devs = makeDiaDeviations();
        expect(tuneDIA(devs, 5)).toBe(5);
    });

    it('adjusts DIA down when meanBest < 2 and RMSBest < 2', () => {
        // Index 0 and 1 have lowest deviations, and index 1 meets threshold
        const devs = makeDiaDeviations([
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 4, RMSDeviation: 4 },
            { meanDeviation: 7, RMSDeviation: 8 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 11, RMSDeviation: 12 },
        ]);
        expect(tuneDIA(devs, 5)).toBe(4); // diaDeviations[1].dia
    });

    it('adjusts DIA up when meanBest > 2 and RMSBest > 2', () => {
        // Index 3 and 4 have lowest deviations, and index 3 meets threshold
        const devs = makeDiaDeviations([
            { meanDeviation: 11, RMSDeviation: 12 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 7, RMSDeviation: 8 },
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 2, RMSDeviation: 2 },
        ]);
        expect(tuneDIA(devs, 5)).toBe(6); // diaDeviations[3].dia
    });

    it('does not adjust when threshold not met (best < 2 but deviations[1] not below threshold)', () => {
        // meanBest=0, RMSBest=1, but deviations[1] is only slightly below current
        const devs = makeDiaDeviations([
            { meanDeviation: 5, RMSDeviation: 7 },
            { meanDeviation: 6.95, RMSDeviation: 7.95 }, // very close to current * 0.99
            { meanDeviation: 7, RMSDeviation: 8 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 11, RMSDeviation: 12 },
        ]);
        expect(tuneDIA(devs, 5)).toBe(5); // unchanged
    });

    it('caps DIA at MAX_DIA_HOURS (12)', () => {
        const devs: AutotuneDiaDeviation[] = [
            { dia: 10, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
            { dia: 11, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
            { dia: 12, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },
            { dia: 13, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },
            { dia: 14, meanDeviation: 2, SMRDeviation: 1, RMSDeviation: 2 },
        ];
        expect(tuneDIA(devs, 12)).toBe(12);
    });

    it('logs adjustment when DIA changes', () => {
        const devs = makeDiaDeviations([
            { meanDeviation: 3, RMSDeviation: 3 },
            { meanDeviation: 4, RMSDeviation: 4 },
        ]);
        tuneDIA(devs, 5);
        expect(console.log).toHaveBeenCalledWith(
            "Adjusting insulinEndTime from 5 to 4 hours",
        );
    });

    it('logs unchanged when DIA stays the same', () => {
        const devs = makeDiaDeviations();
        tuneDIA(devs, 5);
        expect(console.log).toHaveBeenCalledWith(
            "Leaving insulinEndTime unchanged at 5 hours",
        );
    });

    it('does not adjust up when threshold is not met (best > 2 but improvement too small)', () => {
        // meanBest > 2 and RMSBest > 2, but deviations[3] improvement doesn't meet 0.99 threshold
        const devs = makeDiaDeviations([
            { meanDeviation: 11, RMSDeviation: 12 },
            { meanDeviation: 9, RMSDeviation: 10 },
            { meanDeviation: 7, RMSDeviation: 8 },  // current
            { meanDeviation: 6.95, RMSDeviation: 7.95 }, // NOT below 7*0.99=6.93 / 8*0.99=7.92
            { meanDeviation: 2, RMSDeviation: 2 },
        ]);
        expect(tuneDIA(devs, 5)).toBe(5); // unchanged
    });

    it('caps newDIA at MAX_DIA_HOURS (12) when adjusted upward beyond max', () => {
        // Both metrics favor longer DIA, and adjustment passes threshold
        // but the new DIA from deviations[3].dia = 14 > 12
        const devs: AutotuneDiaDeviation[] = [
            { dia: 11, meanDeviation: 11, SMRDeviation: 10, RMSDeviation: 12 },
            { dia: 12, meanDeviation: 9, SMRDeviation: 8, RMSDeviation: 10 },
            { dia: 13, meanDeviation: 7, SMRDeviation: 6, RMSDeviation: 8 },  // current index 2
            { dia: 14, meanDeviation: 3, SMRDeviation: 2, RMSDeviation: 3 },  // meets threshold
            { dia: 15, meanDeviation: 2, SMRDeviation: 1, RMSDeviation: 2 },
        ];
        const result = tuneDIA(devs, 13);
        // newDIA = 14, but 14 > 12 → capped at 12
        expect(result).toBe(12);
        expect(console.log).toHaveBeenCalledWith(
            "insulinEndTime maximum is 12h: not raising further",
        );
    });
});
