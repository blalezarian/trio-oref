import { describe, it, expect, vi } from 'vitest';
import { iobTotal } from '../../../src/iob/sum-iob';
import type { Treatment, IOBContribution, InsulinCurve } from '../../../src/types/index';
import type { IobCalcProfile, IobTotalOpts, IobTotalResult } from '../../../src/iob/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = new Date('2025-01-15T12:00:00.000Z');
const FIXED_MS = FIXED_TIME.getTime();
const MS_PER_HOUR = 3_600_000;

/** Create a minimal Treatment with sensible defaults */
function makeTreatment(overrides: Partial<Treatment> = {}): Treatment {
    return {
        date: FIXED_MS - MS_PER_HOUR, // 1 hour ago by default
        ...overrides,
    };
}

/** Create a minimal IobCalcProfile */
function makeProfile(overrides: Partial<IobCalcProfile> = {}): IobCalcProfile {
    return {
        dia: 6,
        curve: 'rapid-acting',
        ...overrides,
    };
}

/** Build IobTotalOpts with a controllable mock calculate function */
function makeOpts(
    treatments: Treatment[] | null,
    profile: IobCalcProfile,
    calculateReturn: IOBContribution | Record<string, never> = { iobContrib: 0, activityContrib: 0 },
): IobTotalOpts {
    return {
        treatments,
        profile,
        calculate: vi.fn().mockReturnValue(calculateReturn),
    };
}

/** Type guard: result is a full IobTotalResult (not empty {}) */
function isResult(r: IobTotalResult | Record<string, never>): r is IobTotalResult {
    return 'iob' in r;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('iobTotal', () => {

    // -----------------------------------------------------------------------
    // Null / empty treatments
    // -----------------------------------------------------------------------

    describe('when treatments is null', () => {
        it('returns an empty object', () => {
            const opts = makeOpts(null, makeProfile());
            const result = iobTotal(opts, FIXED_TIME);

            expect(result).toEqual({});
            expect(isResult(result)).toBe(false);
        });

        it('never calls calculate', () => {
            const opts = makeOpts(null, makeProfile());
            iobTotal(opts, FIXED_TIME);

            expect(opts.calculate).not.toHaveBeenCalled();
        });
    });

    describe('when treatments is an empty array', () => {
        it('returns all-zero IOB fields', () => {
            const opts = makeOpts([], makeProfile());
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0);
            expect(result.activity).toBe(0);
            expect(result.basaliob).toBe(0);
            expect(result.bolusiob).toBe(0);
            expect(result.netbasalinsulin).toBe(0);
            expect(result.bolusinsulin).toBe(0);
            expect(result.time).toBe(FIXED_TIME);
        });
    });

    // -----------------------------------------------------------------------
    // Expired treatments (past DIA)
    // -----------------------------------------------------------------------

    describe('when all treatments are past DIA', () => {
        it('returns zeros because calculate is never called for expired treatments', () => {
            const profile = makeProfile({ dia: 6 });
            // Treatment 7 hours ago — beyond 6h DIA
            const treatment = makeTreatment({
                insulin: 1,
                date: FIXED_MS - 7 * MS_PER_HOUR,
            });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.5, activityContrib: 0.1 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0);
            expect(result.activity).toBe(0);
            expect(result.basaliob).toBe(0);
            expect(result.bolusiob).toBe(0);
            expect(opts.calculate).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Future treatments (date > now)
    // -----------------------------------------------------------------------

    describe('when treatment date is in the future', () => {
        it('skips the treatment entirely', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({
                insulin: 1,
                date: FIXED_MS + MS_PER_HOUR, // 1 hour in the future
            });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.5, activityContrib: 0.1 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0);
            expect(opts.calculate).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Summing IOB across multiple treatments
    // -----------------------------------------------------------------------

    describe('summing multiple treatments', () => {
        it('accumulates iob and activity from all active treatments', () => {
            const profile = makeProfile();
            const t1 = makeTreatment({ insulin: 1.0, date: FIXED_MS - MS_PER_HOUR });
            const t2 = makeTreatment({ insulin: 2.0, date: FIXED_MS - 2 * MS_PER_HOUR });
            const t3 = makeTreatment({ insulin: 0.5, date: FIXED_MS - 3 * MS_PER_HOUR });

            const calcMock = vi.fn()
                .mockReturnValueOnce({ iobContrib: 0.8, activityContrib: 0.01 })
                .mockReturnValueOnce({ iobContrib: 0.4, activityContrib: 0.02 })
                .mockReturnValueOnce({ iobContrib: 0.1, activityContrib: 0.005 });

            const opts: IobTotalOpts = {
                treatments: [t1, t2, t3],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            // 0.8 + 0.4 + 0.1 = 1.3
            expect(result.iob).toBe(1.3);
            // 0.01 + 0.02 + 0.005 = 0.035
            expect(result.activity).toBe(0.035);
            expect(calcMock).toHaveBeenCalledTimes(3);
        });
    });

    // -----------------------------------------------------------------------
    // Basal vs bolus IOB separation
    // -----------------------------------------------------------------------

    describe('basal/bolus IOB separation', () => {
        it('classifies treatment.insulin < 0.1 as basaliob', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 0.05, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.03, activityContrib: 0.001 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.basaliob).toBe(0.03);
            expect(result.bolusiob).toBe(0);
            expect(result.netbasalinsulin).toBe(0.05);
            expect(result.bolusinsulin).toBe(0);
        });

        it('classifies treatment.insulin >= 0.1 as bolusiob', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 0.5, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.3, activityContrib: 0.01 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.bolusiob).toBe(0.3);
            expect(result.basaliob).toBe(0);
            expect(result.bolusinsulin).toBe(0.5);
            expect(result.netbasalinsulin).toBe(0);
        });

        it('classifies treatment.insulin exactly 0.1 as bolusiob', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 0.1, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.08, activityContrib: 0.005 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.bolusiob).toBe(0.08);
            expect(result.basaliob).toBe(0);
        });

        it('classifies negative insulin (net negative basal) as basaliob', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: -0.05, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: -0.03, activityContrib: -0.001 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.basaliob).toBe(-0.03);
            expect(result.bolusiob).toBe(0);
            expect(result.netbasalinsulin).toBe(-0.05);
        });

        it('separates basal and bolus treatments in a mixed set', () => {
            const profile = makeProfile();
            const basalTreatment = makeTreatment({ insulin: 0.05, date: FIXED_MS - MS_PER_HOUR });
            const bolusTreatment = makeTreatment({ insulin: 2.0, date: FIXED_MS - 2 * MS_PER_HOUR });

            const calcMock = vi.fn()
                .mockReturnValueOnce({ iobContrib: 0.03, activityContrib: 0.001 })
                .mockReturnValueOnce({ iobContrib: 1.2, activityContrib: 0.05 });

            const opts: IobTotalOpts = {
                treatments: [basalTreatment, bolusTreatment],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.basaliob).toBe(0.03);
            expect(result.bolusiob).toBe(1.2);
            expect(result.netbasalinsulin).toBe(0.05);
            expect(result.bolusinsulin).toBe(2.0);
            // Total IOB is sum of both
            expect(result.iob).toBe(1.23);
        });
    });

    // -----------------------------------------------------------------------
    // Treatment with no insulin field
    // -----------------------------------------------------------------------

    describe('treatment with no insulin field', () => {
        it('contributes to total iob but not basaliob or bolusiob', () => {
            const profile = makeProfile();
            // No insulin field at all
            const treatment = makeTreatment({ date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.5, activityContrib: 0.01 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            // iobContrib is added to total iob
            expect(result.iob).toBe(0.5);
            expect(result.activity).toBe(0.01);
            // But not categorized as basal or bolus
            expect(result.basaliob).toBe(0);
            expect(result.bolusiob).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rounding
    // -----------------------------------------------------------------------

    describe('rounding', () => {
        it('rounds iob to 3 decimal places', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 1.0, date: FIXED_MS - MS_PER_HOUR });
            // 0.12345 rounds to 0.123
            const opts = makeOpts([treatment], profile, { iobContrib: 0.12345, activityContrib: 0 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0.123);
        });

        it('rounds activity to 4 decimal places', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 1.0, date: FIXED_MS - MS_PER_HOUR });
            // 0.123456 rounds to 0.1235
            const opts = makeOpts([treatment], profile, { iobContrib: 0, activityContrib: 0.123456 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.activity).toBe(0.1235);
        });

        it('rounds basaliob, bolusiob, netbasalinsulin, bolusinsulin to 3dp', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 0.05678, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, { iobContrib: 0.04567, activityContrib: 0 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            // 0.04567 rounds to 0.046
            expect(result.basaliob).toBe(0.046);
            // 0.05678 rounds to 0.057
            expect(result.netbasalinsulin).toBe(0.057);
        });

        it('uses Math.round semantics (0.5 rounds up)', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 1.0, date: FIXED_MS - MS_PER_HOUR });
            // 0.1115 * 1000 = 111.5 -> rounds to 112 -> 0.112
            const opts = makeOpts([treatment], profile, { iobContrib: 0.1115, activityContrib: 0 });
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0.112);
        });
    });

    // -----------------------------------------------------------------------
    // Minimum DIA enforcement
    // -----------------------------------------------------------------------

    describe('minimum DIA enforcement', () => {
        it('forces minimum DIA of 3h for bilinear curve', () => {
            const profile = makeProfile({ dia: 1, curve: 'bilinear' });
            // Treatment 2.5h ago — past 1h DIA but within 3h floor
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - 2.5 * MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.1, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            // Treatment was included (within 3h floor), so calculate was called
            expect(calcMock).toHaveBeenCalledTimes(1);
            // Verify DIA passed to calculate was 3, not 1
            expect(calcMock.mock.calls[0][3]).toBe(3);
        });

        it('forces minimum DIA of 5h for rapid-acting curve', () => {
            const profile = makeProfile({ dia: 4, curve: 'rapid-acting' });
            // Treatment 4.5h ago — past 4h DIA but within 5h floor
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - 4.5 * MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.05, activityContrib: 0.005 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(calcMock).toHaveBeenCalledTimes(1);
            // DIA should be bumped to 5
            expect(calcMock.mock.calls[0][3]).toBe(5);
        });

        it('forces minimum DIA of 5h for ultra-rapid curve', () => {
            const profile = makeProfile({ dia: 4, curve: 'ultra-rapid' });
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - 4.5 * MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.05, activityContrib: 0.005 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(calcMock).toHaveBeenCalledTimes(1);
            expect(calcMock.mock.calls[0][3]).toBe(5);
        });

        it('does not enforce 5h minimum for bilinear curve', () => {
            const profile = makeProfile({ dia: 4, curve: 'bilinear' });
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // DIA stays at 4, not bumped to 5
            expect(calcMock.mock.calls[0][3]).toBe(4);
        });

        it('does not lower DIA when it exceeds the minimum', () => {
            const profile = makeProfile({ dia: 8, curve: 'rapid-acting' });
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.9, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // DIA stays at 8
            expect(calcMock.mock.calls[0][3]).toBe(8);
        });
    });

    // -----------------------------------------------------------------------
    // Unsupported curve handling
    // -----------------------------------------------------------------------

    describe('unsupported curve name', () => {
        it('defaults to rapid-acting and logs error', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const profile = makeProfile({ dia: 6, curve: 'unknown-curve' as InsulinCurve });
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // Should log an error about the unsupported curve
            expect(consoleSpy).toHaveBeenCalledTimes(1);
            expect(consoleSpy.mock.calls[0][0]).toContain('Unsupported curve function');
            expect(consoleSpy.mock.calls[0][0]).toContain('unknown-curve');

            // Should fall back to rapid-acting — curve argument is the 3rd positional arg
            expect(calcMock.mock.calls[0][2]).toBe('rapid-acting');

            consoleSpy.mockRestore();
        });

        it('enforces 5h minimum DIA after defaulting to rapid-acting', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const profile = makeProfile({ dia: 4, curve: 'made-up' as InsulinCurve });
            const treatment = makeTreatment({
                insulin: 1.0,
                date: FIXED_MS - 4.5 * MS_PER_HOUR,
            });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.05, activityContrib: 0.005 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            // After defaulting to rapid-acting, DIA should be bumped to 5
            expect(calcMock).toHaveBeenCalledTimes(1);
            expect(calcMock.mock.calls[0][3]).toBe(5);

            consoleSpy.mockRestore();
        });
    });

    // -----------------------------------------------------------------------
    // Curve and peak selection
    // -----------------------------------------------------------------------

    describe('curve and peak selection', () => {
        it('passes rapid-acting peak (75) to calculate', () => {
            const profile = makeProfile({ dia: 6, curve: 'rapid-acting' });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // peak is 5th argument (index 4)
            expect(calcMock.mock.calls[0][4]).toBe(75);
        });

        it('passes ultra-rapid peak (55) to calculate', () => {
            const profile = makeProfile({ dia: 6, curve: 'ultra-rapid' });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            expect(calcMock.mock.calls[0][4]).toBe(55);
        });

        it('passes bilinear peak (75) to calculate', () => {
            const profile = makeProfile({ dia: 6, curve: 'bilinear' });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // Bilinear also uses RAPID_ACTING_PEAK (75) as its default
            expect(calcMock.mock.calls[0][4]).toBe(75);
        });
    });

    // -----------------------------------------------------------------------
    // Calculate returning empty object
    // -----------------------------------------------------------------------

    describe('when calculate returns empty object', () => {
        it('does not add to iob or activity', () => {
            const profile = makeProfile();
            const treatment = makeTreatment({ insulin: 1.0, date: FIXED_MS - MS_PER_HOUR });
            const opts = makeOpts([treatment], profile, {} as IOBContribution);
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.iob).toBe(0);
            expect(result.activity).toBe(0);
            expect(result.basaliob).toBe(0);
            expect(result.bolusiob).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Result time field
    // -----------------------------------------------------------------------

    describe('result time field', () => {
        it('includes the time argument in the result', () => {
            const opts = makeOpts([], makeProfile());
            const result = iobTotal(opts, FIXED_TIME);

            expect(isResult(result)).toBe(true);
            if (!isResult(result)) return;

            expect(result.time).toBe(FIXED_TIME);
        });
    });

    // -----------------------------------------------------------------------
    // Curve case-insensitivity
    // -----------------------------------------------------------------------

    describe('curve name case handling', () => {
        it('lowercases the curve name from the profile', () => {
            const profile = makeProfile({ dia: 6, curve: 'Rapid-Acting' as InsulinCurve });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // Should pass lowercased curve name
            expect(calcMock.mock.calls[0][2]).toBe('rapid-acting');
        });
    });

    // -----------------------------------------------------------------------
    // Undefined curve falls back to bilinear
    // -----------------------------------------------------------------------

    describe('when profile.curve is undefined', () => {
        it('defaults to bilinear', () => {
            const profile = makeProfile({ dia: 6, curve: undefined });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // curve arg should be 'bilinear'
            expect(calcMock.mock.calls[0][2]).toBe('bilinear');
        });

        it('does not enforce 5h minimum for default bilinear curve', () => {
            const profile = makeProfile({ dia: 4, curve: undefined });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // DIA stays at 4, not bumped to 5 (bilinear doesn't require long DIA)
            expect(calcMock.mock.calls[0][3]).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Profile passed through to calculate
    // -----------------------------------------------------------------------

    describe('profile forwarding', () => {
        it('passes the profile object to calculate as the 6th argument', () => {
            const profile = makeProfile({ dia: 6, curve: 'rapid-acting' });
            const treatment = makeTreatment({ insulin: 1, date: FIXED_MS - MS_PER_HOUR });
            const calcMock = vi.fn().mockReturnValue({ iobContrib: 0.5, activityContrib: 0.01 });
            const opts: IobTotalOpts = {
                treatments: [treatment],
                profile,
                calculate: calcMock,
            };

            iobTotal(opts, FIXED_TIME);

            // profile_data is passed as the 6th arg (index 5)
            expect(calcMock.mock.calls[0][5]).toBe(profile);
        });
    });
});
