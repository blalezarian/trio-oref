import { describe, it, expect } from 'vitest';

import {
    resolveProfileTarget,
    resolveOverrides,
} from '../../../src/determineBasal/determineBasal';

import type { Profile, TrioCustomVariables } from '../../../src/types/index';

// OVERRIDE_TARGET_SENTINEL = 6

// ---------------------------------------------------------------------------
// resolveProfileTarget
// ---------------------------------------------------------------------------

describe('resolveProfileTarget', () => {
    it('returns minBG when override is not active', () => {
        expect(resolveProfileTarget(100, 110, false, false)).toBe(100);
    });

    it('returns overrideTarget when active and no temp target', () => {
        expect(resolveProfileTarget(100, 110, true, false)).toBe(110);
    });

    it('returns minBG when overrideTarget is 0 (sentinel for "not set")', () => {
        expect(resolveProfileTarget(100, 0, true, false)).toBe(100);
    });

    it('returns minBG when overrideTarget is OVERRIDE_TARGET_SENTINEL (6)', () => {
        expect(resolveProfileTarget(100, 6, true, false)).toBe(100);
    });

    it('returns minBG when temp target is set (temptargetSet=true)', () => {
        expect(resolveProfileTarget(100, 110, true, true)).toBe(100);
    });

    it('returns minBG when temptargetSet is undefined', () => {
        expect(resolveProfileTarget(100, 110, true, undefined)).toBe(110);
    });
});

// ---------------------------------------------------------------------------
// resolveOverrides
// ---------------------------------------------------------------------------

function makeTrioVars(overrides: Partial<TrioCustomVariables> = {}): TrioCustomVariables {
    return {
        useOverride: false,
        overridePercentage: 100,
        overrideTarget: 0,
        advancedSettings: false,
        isfAndCr: false,
        isf: false,
        cr: false,
        smbIsOff: false,
        smbIsScheduledOff: false,
        start: 0,
        end: 0,
        smbMinutes: 30,
        uamMinutes: 30,
        currentTDD: 0,
        average_total_data: 0,
        weightedAverage: 0,
        duration: 0,
        ...overrides,
    };
}

describe('resolveOverrides', () => {
    const profile = { sens: 50, carb_ratio: 10 } as Profile;

    it('returns defaults when useOverride is false', () => {
        const trio = makeTrioVars({ useOverride: false });
        const result = resolveOverrides(profile, trio);

        expect(result.overrideFactor).toBe(1);
        expect(result.sensitivity).toBe(50);
        expect(result.carbRatio).toBe(10);
    });

    it('applies override factor to both ISF and CR when isfAndCr is true', () => {
        const trio = makeTrioVars({ useOverride: true, overridePercentage: 80, isfAndCr: true });
        const result = resolveOverrides(profile, trio);

        expect(result.overrideFactor).toBe(0.8);
        // sensitivity = 50 / 0.8 = 62.5
        expect(result.sensitivity).toBe(62.5);
        // carbRatio = 10 / 0.8 = 12.5
        expect(result.carbRatio).toBe(12.5);
    });

    it('applies override factor to ISF only when isf=true, cr=false', () => {
        const trio = makeTrioVars({ useOverride: true, overridePercentage: 80, isfAndCr: false, isf: true, cr: false });
        const result = resolveOverrides(profile, trio);

        expect(result.sensitivity).toBe(62.5);
        expect(result.carbRatio).toBe(10); // unchanged
    });

    it('applies override factor to CR only when cr=true, isf=false', () => {
        const trio = makeTrioVars({ useOverride: true, overridePercentage: 80, isfAndCr: false, isf: false, cr: true });
        const result = resolveOverrides(profile, trio);

        expect(result.sensitivity).toBe(50); // unchanged
        expect(result.carbRatio).toBe(12.5);
    });

    it('does not modify sensitivity or CR when override is active but isf/cr/isfAndCr are all false', () => {
        const trio = makeTrioVars({ useOverride: true, overridePercentage: 120, isfAndCr: false, isf: false, cr: false });
        const result = resolveOverrides(profile, trio);

        expect(result.overrideFactor).toBe(1.2);
        expect(result.sensitivity).toBe(50);
        expect(result.carbRatio).toBe(10);
    });
});
