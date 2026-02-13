import { describe, it, expect } from 'vitest';
import { percentile } from '../../../src/utils/percentile';

describe('percentile', () => {
    it('returns 0 for an empty array', () => {
        expect(percentile([], 0.5)).toBe(0);
    });

    it('throws TypeError when p is not a number', () => {
        expect(() => percentile([1, 2, 3], 'half' as unknown as number)).toThrow(TypeError);
        expect(() => percentile([1, 2, 3], 'half' as unknown as number)).toThrow('p must be a number');
    });

    it('returns first element when p <= 0', () => {
        expect(percentile([10, 20, 30], 0)).toBe(10);
        expect(percentile([10, 20, 30], -1)).toBe(10);
    });

    it('returns last element when p >= 1', () => {
        expect(percentile([10, 20, 30], 1)).toBe(30);
        expect(percentile([10, 20, 30], 1.5)).toBe(30);
    });

    it('computes median (p=0.5) for a sorted array', () => {
        // [10, 20, 30] → index = 3*0.5 = 1.5, lower=1, upper=2, weight=0.5
        // result = 20*(1-0.5) + 30*0.5 = 25
        expect(percentile([10, 20, 30], 0.5)).toBe(25);
    });

    it('returns lower element when upper would be out of bounds', () => {
        // [10, 20] → p=0.9, index = 2*0.9 = 1.8, lower=1, upper=2 >= length
        // returns arr[1] = 20
        expect(percentile([10, 20], 0.9)).toBe(20);
    });

    it('interpolates between elements', () => {
        // [10, 20, 30, 40] → p=0.25, index = 4*0.25 = 1, lower=1, upper=2, weight=0
        // result = 20*(1-0) + 30*0 = 20
        expect(percentile([10, 20, 30, 40], 0.25)).toBe(20);
    });

    it('handles single-element array', () => {
        // p=0 → first element; p=1 → last element; p=0.5 → upper >= length
        expect(percentile([42], 0)).toBe(42);
        expect(percentile([42], 0.5)).toBe(42);
        expect(percentile([42], 1)).toBe(42);
    });

    it('handles p as undefined (throws TypeError)', () => {
        expect(() => percentile([1, 2, 3], undefined as unknown as number)).toThrow(TypeError);
    });
});
