import { describe, it, expect, vi } from 'vitest';

const { mockGetTime } = vi.hoisted(() => {
    const mockGetTime = (minutes: number) => {
        const baseTime = new Date(2025, 0, 26, 0, 0, 0);
        return baseTime.getTime() + minutes * 60 * 1000;
    };
    return { mockGetTime };
});

vi.mock('../../src/utils/time', () => ({
    scheduleOffsetToEpoch: mockGetTime,
}));

import { carbRatioLookup } from '../../src/profile/carbs';

describe('Carb Ratio Profile', () => {
    const carbratio_input = {
        units: 'grams' as const,
        schedule: [
            { offset: 0, ratio: 15, start: '00:00:00' },
            { offset: 180, ratio: 18, start: '03:00:00' },
            { offset: 360, ratio: 20, start: '06:00:00' }
        ]
    };

    it('should return current carb ratio from schedule', () => {
        const now = new Date('2025-01-26T02:00:00');
        const ratio = carbRatioLookup({ carbratio: carbratio_input }, now);
        expect(ratio).toBe(15);
    });

    it('should handle ratio schedule changes', () => {
        const now = new Date('2025-01-26T04:00:00');
        const ratio = carbRatioLookup({ carbratio: carbratio_input }, now);
        expect(ratio).toBe(18);
    });

    it('should handle exchanges unit conversion', () => {
        const exchange_input = {
            units: 'exchanges' as const,
            schedule: [
                { offset: 0, ratio: 12, start: '00:00:00' }
            ]
        };
        const now = new Date('2025-01-26T04:00:00');
        const ratio = carbRatioLookup({ carbratio: exchange_input }, now);
        expect(ratio).toBe(1); // 12 grams per exchange
    });

    it('should reject invalid ratios', () => {
        const invalid_input = {
            units: 'grams' as const,
            schedule: [
                { offset: 0, ratio: 0.5, start: '00:00:00' } // Less than min of 1
            ]
        };
        const ratio = carbRatioLookup({ carbratio: invalid_input });
        expect(ratio).toBeUndefined();
    });
});
