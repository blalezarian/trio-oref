import { describe, it, expect } from 'vitest';
import { findLastBolusAndTemp } from '../../../src/iob/findLastBolusAndTemp';
import type { IobTreatment } from '../../../src/iob/types';
import {
    FIXED_MS,
    MS_PER_MINUTE,
    makeIobTreatment,
} from '../helpers/factories';

function makeBolus(offsetMin: number, insulin: number): IobTreatment {
    return makeIobTreatment(offsetMin, { insulin });
}

function makeTemp(offsetMin: number, rate: number, duration: number): IobTreatment {
    return makeIobTreatment(offsetMin, { rate, duration });
}

describe('findLastBolusAndTemp', () => {

    it('returns epoch-zero defaults for empty treatments', () => {
        const result = findLastBolusAndTemp([]);
        expect(result.lastBolusTime).toBe(new Date(0).getTime());
        expect(result.lastTemp.date).toBe(new Date(0).getTime());
    });

    it('finds most recent bolus time from multiple boluses', () => {
        const treatments = [
            makeBolus(0, 1.0),
            makeBolus(30, 2.0),
            makeBolus(10, 0.5),
        ];
        const result = findLastBolusAndTemp(treatments);
        expect(result.lastBolusTime).toBe(FIXED_MS + 30 * MS_PER_MINUTE);
    });

    it('finds most recent temp basal', () => {
        const treatments = [
            makeTemp(0, 1.5, 30),
            makeTemp(60, 0.8, 20),
            makeTemp(30, 1.0, 15),
        ];
        const result = findLastBolusAndTemp(treatments);
        expect(result.lastTemp.date).toBe(FIXED_MS + 60 * MS_PER_MINUTE);
        expect(result.lastTemp.rate).toBe(0.8);
    });

    it('rounds lastTemp duration to 2 decimal places', () => {
        const treatments = [
            makeTemp(0, 1.0, 29.999999),
        ];
        const result = findLastBolusAndTemp(treatments);
        expect(result.lastTemp.duration).toBe(30);
    });

    it('handles mix of boluses and temps', () => {
        const treatments = [
            makeBolus(10, 2.0),
            makeTemp(20, 1.0, 30),
            makeBolus(5, 1.0),
            makeTemp(40, 0.5, 15),
        ];
        const result = findLastBolusAndTemp(treatments);
        expect(result.lastBolusTime).toBe(FIXED_MS + 10 * MS_PER_MINUTE);
        expect(result.lastTemp.date).toBe(FIXED_MS + 40 * MS_PER_MINUTE);
    });

    it('ignores treatments with no insulin and no rate', () => {
        const treatments: IobTreatment[] = [
            { date: FIXED_MS }, // no insulin, no rate
        ];
        const result = findLastBolusAndTemp(treatments);
        expect(result.lastBolusTime).toBe(new Date(0).getTime());
        expect(result.lastTemp.date).toBe(new Date(0).getTime());
    });
});
