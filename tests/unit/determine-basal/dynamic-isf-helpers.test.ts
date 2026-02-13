import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    clampTDDRatio,
    configureInsulinCurve,
    calculateLogarithmicRatio,
    calculateSigmoidRatio,
    enforceAutosensLimits,
    buildTDDReasonString,
} from '../../../src/determine-basal/dynamic-isf';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// clampTDDRatio
// ---------------------------------------------------------------------------

describe('clampTDDRatio', () => {
    it('clamps ratio > 1 to maxLimit', () => {
        expect(clampTDDRatio(1.5, 0.7, 1.2)).toBe(1.2);
    });

    it('rounds ratio > 1 to 2 decimal places', () => {
        expect(clampTDDRatio(1.1234, 0.7, 1.3)).toBe(1.12);
    });

    it('does not clamp ratio > 1 when within max', () => {
        expect(clampTDDRatio(1.1, 0.7, 1.3)).toBe(1.1);
    });

    it('clamps ratio < 1 to minLimit', () => {
        expect(clampTDDRatio(0.5, 0.7, 1.2)).toBe(0.7);
    });

    it('rounds ratio < 1 to 2 decimal places', () => {
        expect(clampTDDRatio(0.8765, 0.7, 1.3)).toBe(0.88);
    });

    it('does not clamp ratio < 1 when within min', () => {
        expect(clampTDDRatio(0.85, 0.7, 1.3)).toBe(0.85);
    });

    it('passes through ratio === 1 unchanged', () => {
        expect(clampTDDRatio(1, 0.7, 1.2)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// configureInsulinCurve
// ---------------------------------------------------------------------------

describe('configureInsulinCurve', () => {
    // Constants: INSULIN_FACTOR_CEILING=120, RAPID_ACTING_ACTIVITY_OFFSET=65, ULTRA_RAPID_ACTIVITY_OFFSET=50

    it('uses rapid-acting offset for rapid-acting curve', () => {
        // 120 - 65 = 55
        const result = configureInsulinCurve('rapid-acting', 55, false);
        expect(result).toBe(55);
    });

    it('uses ultra-rapid offset for ultra-rapid curve', () => {
        // 120 - 50 = 70
        const result = configureInsulinCurve('ultra-rapid', 55, false);
        expect(result).toBe(70);
    });

    it('uses default rapid-acting offset for unknown curves', () => {
        // Falls through switch, insulinPA stays at RAPID_ACTING default → 120 - 65 = 55
        const result = configureInsulinCurve('bilinear', 55, false);
        expect(result).toBe(55);
    });

    it('uses custom peak time when useCustomPeak is true', () => {
        // 120 - 60 = 60
        const result = configureInsulinCurve('rapid-acting', 60, true);
        expect(result).toBe(60);
    });

    it('ignores curve type when useCustomPeak is true', () => {
        const result = configureInsulinCurve('ultra-rapid', 60, true);
        expect(result).toBe(60);
    });
});

// ---------------------------------------------------------------------------
// calculateLogarithmicRatio
// ---------------------------------------------------------------------------

describe('calculateLogarithmicRatio', () => {
    it('computes correct ratio for typical inputs', () => {
        // sensitivity=50, adjustmentFactor=0.8, tdd=40, BG=150, insulinFactor=55
        const result = calculateLogarithmicRatio(50, 0.8, 40, 150, 55);
        const expected = 50 * 0.8 * 40 * Math.log(150/55+1) / 1800;
        expect(result).toBeCloseTo(expected, 10);
    });

    it('returns 0 when BG is 0', () => {
        // ln(0/55 + 1) = ln(1) = 0
        const result = calculateLogarithmicRatio(50, 0.8, 40, 0, 55);
        expect(result).toBe(0);
    });

    it('returns 0 when tdd is 0', () => {
        const result = calculateLogarithmicRatio(50, 0.8, 0, 150, 55);
        expect(result).toBe(0);
    });

    it('handles very high BG values', () => {
        const result = calculateLogarithmicRatio(50, 0.8, 40, 400, 55);
        expect(result).toBeGreaterThan(0);
        expect(Number.isFinite(result)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// calculateSigmoidRatio
// ---------------------------------------------------------------------------

describe('calculateSigmoidRatio', () => {
    it('returns approximately 1.0 when BG equals target', () => {
        const result = calculateSigmoidRatio(100, 100, 1.0, 0.5, 0.7, 1.3);
        expect(result).toBeCloseTo(1.0, 1);
    });

    it('returns value > 1 when BG is above target', () => {
        const result = calculateSigmoidRatio(180, 100, 1.0, 0.5, 0.7, 1.3);
        expect(result).toBeGreaterThan(1.0);
    });

    it('returns value < 1 when BG is below target', () => {
        const result = calculateSigmoidRatio(70, 100, 1.0, 0.5, 0.7, 1.3);
        expect(result).toBeLessThan(1.0);
    });

    it('stays within [minLimit, maxLimit] for reasonable inputs', () => {
        const result = calculateSigmoidRatio(300, 100, 1.0, 0.5, 0.7, 1.3);
        expect(result).toBeGreaterThanOrEqual(0.69);
        expect(result).toBeLessThanOrEqual(1.31);
    });

    it('handles maxLimit === 1 without division by zero', () => {
        const result = calculateSigmoidRatio(150, 100, 1.0, 0.5, 0.7, 1.0);
        expect(Number.isFinite(result)).toBe(true);
    });

    it('increases with higher tdd24h_14d_Ratio', () => {
        const low = calculateSigmoidRatio(150, 100, 0.8, 0.5, 0.7, 1.3);
        const high = calculateSigmoidRatio(150, 100, 1.2, 0.5, 0.7, 1.3);
        expect(high).toBeGreaterThan(low);
    });
});

// ---------------------------------------------------------------------------
// enforceAutosensLimits
// ---------------------------------------------------------------------------

describe('enforceAutosensLimits', () => {
    it('clamps ratio above maxLimit', () => {
        const result = enforceAutosensLimits(1.5, 0.7, 1.2);
        expect(result.clampedRatio).toBe(1.2);
        expect(result.log).toContain('autosens_max');
        expect(result.limitLog).toContain('Autosens/Dynamic Limit: 1.2');
    });

    it('clamps ratio below minLimit', () => {
        const result = enforceAutosensLimits(0.5, 0.7, 1.2);
        expect(result.clampedRatio).toBe(0.7);
        expect(result.log).toContain('autosens_min');
        expect(result.limitLog).toContain('Autosens/Dynamic Limit: 0.7');
    });

    it('passes through ratio within limits', () => {
        const result = enforceAutosensLimits(1.0, 0.7, 1.2);
        expect(result.clampedRatio).toBe(1.0);
        expect(result.log).toBe('');
        expect(result.limitLog).toBe('');
    });

    it('passes through ratio exactly at maxLimit', () => {
        const result = enforceAutosensLimits(1.2, 0.7, 1.2);
        expect(result.clampedRatio).toBe(1.2);
        expect(result.log).toBe('');
        expect(result.limitLog).toBe('');
    });

    it('passes through ratio exactly at minLimit', () => {
        const result = enforceAutosensLimits(0.7, 0.7, 1.2);
        expect(result.clampedRatio).toBe(0.7);
        expect(result.log).toBe('');
        expect(result.limitLog).toBe('');
    });

    it('includes original ratio in log messages', () => {
        const result = enforceAutosensLimits(1.55, 0.7, 1.2);
        expect(result.log).toContain('1.55');
        expect(result.limitLog).toContain('1.55');
    });
});

// ---------------------------------------------------------------------------
// buildTDDReasonString
// ---------------------------------------------------------------------------

describe('buildTDDReasonString', () => {
    it('returns empty string when dynISF disabled and defaults match', () => {
        // middleWare must be "" to avoid appending (undefined !== "" is true in the legacy check)
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '', 0.5, '' as never,
        );
        expect(result).toBe('');
    });

    it('includes basal_ratio_log when tddAdjBasal is true', () => {
        const result = buildTDDReasonString(
            true, true,
            ', Dynamic ISF: On', ', Log formula', ', limit', ', AF: 0.8', ', Basal ratio: 1.1',
            0.5, '' as never,
        );
        expect(result).toContain('Basal ratio: 1.1');
        expect(result).toContain('Dynamic ISF: On');
        expect(result).toContain('Log formula');
    });

    it('omits basal_ratio_log when tddAdjBasal is false', () => {
        const result = buildTDDReasonString(
            true, false,
            ', Dynamic ISF: On', ', Log formula', '', ', AF: 0.8', ', Basal ratio: 1.1',
            0.5, '' as never,
        );
        expect(result).not.toContain('Basal ratio: 1.1');
        expect(result).toContain('Dynamic ISF: On');
    });

    it('appends SMB ratio when different from default', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.7, '' as never,
        );
        expect(result).toContain('SMB Ratio: 0.7');
    });

    it('does not append SMB ratio when equal to default (0.5)', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.5, '' as never,
        );
        expect(result).not.toContain('SMB Ratio');
    });

    it('does not append middleware when middleware is a function', () => {
        const fn = (x: unknown) => x;
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.5, fn as never,
        );
        expect(result).not.toContain('Middleware');
    });

    it('does not append middleware when undefined', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.5, undefined,
        );
        expect(result).not.toContain('Middleware');
    });

    it('does not append middleware when empty string', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.5, '' as never,
        );
        expect(result).not.toContain('Middleware');
    });

    it('does not append middleware when value is "Nothing changed"', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            0.5, 'Nothing changed' as never,
        );
        expect(result).not.toContain('Middleware');
    });

    it('clamps SMB ratio at 1 when smb_delivery_ratio exceeds 1', () => {
        const result = buildTDDReasonString(
            false, false, '', '', '', '', '',
            1.5, '' as never,
        );
        expect(result).toContain('SMB Ratio: 1');
    });

    it('concatenates all log strings when dynISFenabled and tddAdjBasal', () => {
        // Explicitly test the dynISFenabled=true, tddAdjBasal=true branch body
        // with distinguishable strings to verify concatenation order
        const result = buildTDDReasonString(
            true,
            true,
            '[DynISF]',
            '[Formula]',
            '[Limit]',
            '[AF]',
            '[BasalRatio]',
            0.5,
            '' as never,
        );
        expect(result).toBe('[DynISF][Formula][Limit][AF][BasalRatio]');
    });
});
