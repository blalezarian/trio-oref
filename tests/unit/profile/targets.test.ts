import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bgTargetsLookup, lookup, bound_target_range } from '../../../src/profile/targets';
import type { TargetsInputs, TargetsProfile } from '../../../src/profile/targets';

/** Noon local time — avoids UTC-vs-local issues with getTime() from medtronic-clock */
const FIXED_TIME = new Date(2025, 0, 15, 12, 0, 0);

function makeInputs(overrides: Partial<TargetsInputs> = {}): TargetsInputs {
    return {
        targets: {
            targets: [
                { offset: 0, low: 100, high: 120 },
            ],
        },
        temptargets: [],
        ...overrides,
    };
}

function makeProfile(overrides: Partial<TargetsProfile> = {}): TargetsProfile {
    return { ...overrides };
}

describe('bound_target_range', () => {
    it('clamps min_bg and max_bg to [80, 200]', () => {
        const target = { low: 70, high: 250 };
        const result = bound_target_range(target);
        expect(result.min_bg).toBe(80);
        expect(result.max_bg).toBe(200);
    });

    it('converts mmol/L to mg/dL when values are below threshold', () => {
        const target = { low: 5.5, high: 6.0 };
        const result = bound_target_range(target);
        // 5.5 * 18 = 99, 6.0 * 18 = 108
        expect(result.low).toBe(99);
        expect(result.high).toBe(108);
        expect(result.min_bg).toBe(99);
        expect(result.max_bg).toBe(108);
    });

    it('preserves normal mg/dL values within bounds', () => {
        const target = { low: 100, high: 120 };
        const result = bound_target_range(target);
        expect(result.min_bg).toBe(100);
        expect(result.max_bg).toBe(120);
    });
});

describe('lookup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FIXED_TIME));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the matching target for current time', () => {
        const inputs = makeInputs({
            targets: {
                targets: [
                    { offset: 0, low: 90, high: 100 },
                    { offset: 480, low: 100, high: 110 },
                    { offset: 960, low: 95, high: 105 },
                ],
            },
        });
        // 12:00 UTC = 720 minutes → between 480 and 960
        const result = lookup(inputs, makeProfile());
        expect(result.low).toBe(100);
    });

    it('applies profile.target_bg override', () => {
        const inputs = makeInputs();
        const result = lookup(inputs, makeProfile({ target_bg: 110 }));
        expect(result.low).toBe(110);
        expect(result.high).toBe(110);
    });

    it('applies active temp target', () => {
        // 1 hour before FIXED_TIME (noon local)
        const oneHourAgo = new Date(2025, 0, 15, 11, 0, 0).toISOString();
        const inputs = makeInputs({
            temptargets: [{
                created_at: oneHourAgo,
                duration: 120,
                targetTop: 150,
                targetBottom: 140,
            }],
        });
        const result = lookup(inputs, makeProfile());
        expect(result.high).toBe(150);
        expect(result.low).toBe(140);
        expect(result.temptargetSet).toBe(true);
    });

    it('cancels temp target with duration 0', () => {
        const oneHourAgo = new Date(2025, 0, 15, 11, 0, 0).toISOString();
        const inputs = makeInputs({
            temptargets: [{
                created_at: oneHourAgo,
                duration: 0,
                targetTop: 150,
                targetBottom: 140,
            }],
        });
        const result = lookup(inputs, makeProfile());
        // Should use regular targets, not temp
        expect(result.temptargetSet).toBeUndefined();
    });

    it('handles empty temptargets array', () => {
        const inputs = makeInputs({ temptargets: [] });
        const result = lookup(inputs, makeProfile());
        expect(result.low).toBe(100);
    });
});

describe('bgTargetsLookup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FIXED_TIME));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns bounded targets', () => {
        const inputs = makeInputs();
        const result = bgTargetsLookup(inputs, makeProfile());
        expect(result.min_bg).toBeDefined();
        expect(result.max_bg).toBeDefined();
        expect(result.min_bg).toBeGreaterThanOrEqual(80);
        expect(result.max_bg).toBeLessThanOrEqual(200);
    });
});
