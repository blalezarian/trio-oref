import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getCurrentBGTarget,
    resolveCurrentTarget,
    clampTargetRange,
    findActiveScheduledTarget,
    applyProfileOverride,
    sortTempTargetsNewestFirst,
    applyTempTargetOverride,
    convertMmolIfNeeded,
    clampToSafeRange,
} from '../../../src/profile/targets';
import type { TargetsInputs, TargetsProfile, TempTarget } from '../../../src/profile/targets';

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

// ---------------------------------------------------------------------------
// convertMmolIfNeeded
// ---------------------------------------------------------------------------

describe('convertMmolIfNeeded', () => {
    it('converts mmol/L values below threshold to mg/dL', () => {
        expect(convertMmolIfNeeded(5.5)).toBe(99);  // 5.5 * 18
        expect(convertMmolIfNeeded(6.0)).toBe(108);  // 6.0 * 18
    });

    it('passes through mg/dL values at or above threshold', () => {
        expect(convertMmolIfNeeded(100)).toBe(100);
        expect(convertMmolIfNeeded(20)).toBe(20);
    });
});

// ---------------------------------------------------------------------------
// clampToSafeRange
// ---------------------------------------------------------------------------

describe('clampToSafeRange', () => {
    it('clamps values below MIN_BG_TARGET (80) up', () => {
        expect(clampToSafeRange(50)).toBe(80);
        expect(clampToSafeRange(0)).toBe(80);
    });

    it('clamps values above MAX_BG_TARGET (200) down', () => {
        expect(clampToSafeRange(250)).toBe(200);
        expect(clampToSafeRange(999)).toBe(200);
    });

    it('passes through values within range', () => {
        expect(clampToSafeRange(100)).toBe(100);
        expect(clampToSafeRange(80)).toBe(80);
        expect(clampToSafeRange(200)).toBe(200);
    });
});

// ---------------------------------------------------------------------------
// clampTargetRange
// ---------------------------------------------------------------------------

describe('clampTargetRange', () => {
    it('sets min_bg and max_bg clamped to [80, 200]', () => {
        const target = { low: 70, high: 250 };
        const result = clampTargetRange(target);
        expect(result.min_bg).toBe(80);
        expect(result.max_bg).toBe(200);
    });

    it('converts mmol/L then clamps', () => {
        const target = { low: 5.5, high: 6.0 };
        const result = clampTargetRange(target);
        expect(result.low).toBe(99);
        expect(result.high).toBe(108);
        expect(result.min_bg).toBe(99);
        expect(result.max_bg).toBe(108);
    });

    it('preserves normal mg/dL values within bounds', () => {
        const target = { low: 100, high: 120 };
        const result = clampTargetRange(target);
        expect(result.min_bg).toBe(100);
        expect(result.max_bg).toBe(120);
    });
});

// ---------------------------------------------------------------------------
// findActiveScheduledTarget
// ---------------------------------------------------------------------------

describe('findActiveScheduledTarget', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_TIME);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the matching entry for the current time of day', () => {
        const targets = [
            { offset: 0, low: 90, high: 100 },
            { offset: 480, low: 100, high: 110 },
            { offset: 960, low: 95, high: 105 },
        ];
        // Noon local = 720 minutes → between 480 and 960
        const result = findActiveScheduledTarget(targets, new Date());
        expect(result.low).toBe(100);
    });

    it('returns the last entry when time is past all offsets', () => {
        vi.setSystemTime(new Date(2025, 0, 15, 23, 0, 0));
        const targets = [
            { offset: 0, low: 90, high: 100 },
            { offset: 480, low: 100, high: 110 },
            { offset: 960, low: 95, high: 105 },
        ];
        const result = findActiveScheduledTarget(targets, new Date());
        expect(result.low).toBe(95);
    });

    it('returns the single entry when only one exists', () => {
        const targets = [{ offset: 0, low: 100, high: 120 }];
        const result = findActiveScheduledTarget(targets, new Date());
        expect(result.low).toBe(100);
    });

    it('handles entries with undefined offset (falls back to 0)', () => {
        const targets = [
            { low: 90, high: 100 },   // offset undefined → 0
            { offset: 960, low: 95, high: 105 },
        ];
        // Noon local = 720 minutes → between offset 0 and 960
        const result = findActiveScheduledTarget(targets, new Date());
        expect(result.low).toBe(90);
    });

    it('returns correct middle entry from three-entry schedule', () => {
        vi.setSystemTime(new Date(2025, 0, 15, 10, 0, 0));
        const targets = [
            { offset: 0, low: 90, high: 100 },
            { offset: 480, low: 100, high: 110 },   // 8:00 AM
            { offset: 960, low: 95, high: 105 },     // 4:00 PM
        ];
        // 10:00 AM → between 480 and 960 → second entry
        const result = findActiveScheduledTarget(targets, new Date());
        expect(result.low).toBe(100);
        expect(result.high).toBe(110);
    });
});

// ---------------------------------------------------------------------------
// applyProfileOverride
// ---------------------------------------------------------------------------

describe('applyProfileOverride', () => {
    it('overrides low with profile.target_bg when it is a number', () => {
        const target = { low: 100, high: 120 };
        const result = applyProfileOverride(target, { target_bg: 110 });
        expect(result.low).toBe(110);
        expect(result.high).toBe(110);
    });

    it('ignores profile.target_bg when it is boolean', () => {
        const target = { low: 100, high: 120 };
        const result = applyProfileOverride(target, { target_bg: false });
        expect(result.low).toBe(100);
        expect(result.high).toBe(100);
    });

    it('sets high = low when no override is present', () => {
        const target = { low: 100, high: 120 };
        const result = applyProfileOverride(target, {});
        expect(result.high).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// sortTempTargetsNewestFirst
// ---------------------------------------------------------------------------

describe('sortTempTargetsNewestFirst', () => {
    it('sorts by created_at descending (newest first)', () => {
        const tempTargets: TempTarget[] = [
            { created_at: '2025-01-15T10:00:00Z', duration: 60 },
            { created_at: '2025-01-15T12:00:00Z', duration: 60 },
            { created_at: '2025-01-15T08:00:00Z', duration: 60 },
        ];
        const sorted = sortTempTargetsNewestFirst(tempTargets);
        expect(sorted[0].created_at).toBe('2025-01-15T12:00:00Z');
        expect(sorted[1].created_at).toBe('2025-01-15T10:00:00Z');
        expect(sorted[2].created_at).toBe('2025-01-15T08:00:00Z');
    });

    it('does not mutate the input array', () => {
        const tempTargets: TempTarget[] = [
            { created_at: '2025-01-15T10:00:00Z', duration: 60 },
            { created_at: '2025-01-15T12:00:00Z', duration: 60 },
        ];
        const original = [...tempTargets];
        sortTempTargetsNewestFirst(tempTargets);
        expect(tempTargets).toEqual(original);
    });
});

// ---------------------------------------------------------------------------
// applyTempTargetOverride
// ---------------------------------------------------------------------------

describe('applyTempTargetOverride', () => {
    const now = FIXED_TIME;
    const oneHourAgo = new Date(2025, 0, 15, 11, 0, 0).toISOString();

    it('applies an active temp target', () => {
        const target = { low: 100, high: 100 };
        const tempTargets: TempTarget[] = [{
            created_at: oneHourAgo,
            duration: 120,
            targetTop: 150,
            targetBottom: 140,
        }];
        const result = applyTempTargetOverride(target, tempTargets, now);
        expect(result.high).toBe(150);
        expect(result.low).toBe(140);
        expect(result.temptargetSet).toBe(true);
    });

    it('cancels temp targets when duration is 0', () => {
        const target = { low: 100, high: 100 };
        const tempTargets: TempTarget[] = [{
            created_at: oneHourAgo,
            duration: 0,
            targetTop: 150,
            targetBottom: 140,
        }];
        const result = applyTempTargetOverride(target, tempTargets, now);
        expect(result.temptargetSet).toBeUndefined();
        expect(result.low).toBe(100);
    });

    it('returns base target for expired temp targets', () => {
        const target = { low: 100, high: 100 };
        const twoHoursAgo = new Date(2025, 0, 15, 10, 0, 0).toISOString();
        const tempTargets: TempTarget[] = [{
            created_at: twoHoursAgo,
            duration: 60,
            targetTop: 150,
            targetBottom: 140,
        }];
        const result = applyTempTargetOverride(target, tempTargets, now);
        expect(result.temptargetSet).toBeUndefined();
    });

    it('logs error and returns base target when targetBottom/targetTop missing', () => {
        const target = { low: 100, high: 100 };
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const tempTargets: TempTarget[] = [{
            created_at: oneHourAgo,
            duration: 120,
        }];
        const result = applyTempTargetOverride(target, tempTargets, now);
        expect(result.temptargetSet).toBeUndefined();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('handles empty array', () => {
        const target = { low: 100, high: 100 };
        const result = applyTempTargetOverride(target, [], now);
        expect(result.low).toBe(100);
    });

    it('handles non-array input gracefully', () => {
        const target = { low: 100, high: 100 };
        const result = applyTempTargetOverride(target, {} as TempTarget[], now);
        expect(result.low).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// resolveCurrentTarget
// ---------------------------------------------------------------------------

describe('resolveCurrentTarget', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_TIME);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the scheduled target for current time', () => {
        const inputs = makeInputs({
            targets: {
                targets: [
                    { offset: 0, low: 90, high: 100 },
                    { offset: 480, low: 100, high: 110 },
                    { offset: 960, low: 95, high: 105 },
                ],
            },
        });
        const result = resolveCurrentTarget(inputs, makeProfile());
        expect(result.low).toBe(100);
    });

    it('applies profile.target_bg override', () => {
        const inputs = makeInputs();
        const result = resolveCurrentTarget(inputs, makeProfile({ target_bg: 110 }));
        expect(result.low).toBe(110);
        expect(result.high).toBe(110);
    });

    it('applies active temp target', () => {
        const oneHourAgo = new Date(2025, 0, 15, 11, 0, 0).toISOString();
        const inputs = makeInputs({
            temptargets: [{
                created_at: oneHourAgo,
                duration: 120,
                targetTop: 150,
                targetBottom: 140,
            }],
        });
        const result = resolveCurrentTarget(inputs, makeProfile());
        expect(result.high).toBe(150);
        expect(result.low).toBe(140);
        expect(result.temptargetSet).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getCurrentBGTarget (end-to-end)
// ---------------------------------------------------------------------------

describe('getCurrentBGTarget', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FIXED_TIME);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns resolved + clamped targets with min_bg and max_bg', () => {
        const inputs = makeInputs();
        const result = getCurrentBGTarget(inputs, makeProfile());
        expect(result.min_bg).toBeDefined();
        expect(result.max_bg).toBeDefined();
        expect(result.min_bg).toBeGreaterThanOrEqual(80);
        expect(result.max_bg).toBeLessThanOrEqual(200);
    });
});
