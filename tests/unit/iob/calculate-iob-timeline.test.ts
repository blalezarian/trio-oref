import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type {
    IobInputs,
    IobProfile,
    IobTreatment,
    IobIndexEntry,
} from '../../../src/iob/types';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the module under test is imported
// ---------------------------------------------------------------------------

vi.mock('../../../src/iob/extract-treatments', () => ({
    calcTempTreatments: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../src/iob/sum-iob', () => ({
    iobTotal: vi.fn().mockImplementation((_opts: unknown, time: Date) => ({
        iob: 0,
        activity: 0,
        basaliob: 0,
        bolusiob: 0,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        time,
    })),
}));

vi.mock('../../../src/iob/find-last-bolus-and-temp', () => ({
    findLastBolusAndTemp: vi.fn().mockReturnValue({
        lastBolusTime: 0,
        lastTemp: { date: 0 },
    }),
}));

vi.mock('../../../src/iob/calculate-single-iob', () => ({
    iobCalc: vi.fn(),
}));

import { generate } from '../../../src/iob/calculate-iob-timeline';
import { calcTempTreatments } from '../../../src/iob/extract-treatments';
import { iobTotal } from '../../../src/iob/sum-iob';
import { findLastBolusAndTemp } from '../../../src/iob/find-last-bolus-and-temp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const FIXED_MS = new Date(FIXED_TIME).getTime();
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Build a minimal IobProfile with sensible defaults */
function makeProfile(overrides: Partial<IobProfile> = {}): IobProfile {
    return {
        dia: 6,
        current_basal: 1.0,
        basalprofile: [
            {
                i: 0,
                start: '00:00:00',
                rate: 1.0,
                minutes: 0,
            },
        ],
        curve: 'rapid-acting',
        ...overrides,
    };
}

/** Build a minimal IobInputs bundle */
function makeInputs(overrides: Partial<IobInputs> = {}): IobInputs {
    return {
        clock: FIXED_TIME,
        history: [],
        profile: makeProfile(),
        ...overrides,
    };
}

/** Reset all mocks to their default implementations */
function resetMocksToDefaults(): void {
    (calcTempTreatments as Mock).mockReset().mockReturnValue([]);
    (iobTotal as Mock).mockReset().mockImplementation((_opts: unknown, time: Date) => ({
        iob: 0,
        activity: 0,
        basaliob: 0,
        bolusiob: 0,
        netbasalinsulin: 0,
        bolusinsulin: 0,
        time,
    }));
    (findLastBolusAndTemp as Mock).mockReset().mockReturnValue({
        lastBolusTime: 0,
        lastTemp: { date: 0 },
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generate (calculate-iob-timeline)', () => {

    beforeEach(() => {
        resetMocksToDefaults();
    });

    // -----------------------------------------------------------------------
    // Empty history — basic structure
    // -----------------------------------------------------------------------

    describe('with empty history', () => {
        it('returns an IOB array with expected structure', () => {
            const inputs = makeInputs();
            const result = generate(inputs);

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);

            const first = result[0];
            expect(first).toHaveProperty('iob');
            expect(first).toHaveProperty('activity');
            expect(first).toHaveProperty('basaliob');
            expect(first).toHaveProperty('bolusiob');
            expect(first).toHaveProperty('netbasalinsulin');
            expect(first).toHaveProperty('bolusinsulin');
            expect(first).toHaveProperty('time');
            expect(first).toHaveProperty('iobWithZeroTemp');
        });
    });

    // -----------------------------------------------------------------------
    // Entry count: currentIOBOnly
    // -----------------------------------------------------------------------

    describe('entry count', () => {
        it('returns exactly 1 entry when currentIOBOnly is true', () => {
            const inputs = makeInputs();
            const result = generate(inputs, true);

            expect(result).toHaveLength(1);
        });

        it('returns 48 entries when currentIOBOnly is false (default)', () => {
            const inputs = makeInputs();
            const result = generate(inputs);

            // 0 to 235 at 5-min intervals: 240/5 = 48
            expect(result).toHaveLength(48);
        });

        it('returns 48 entries when currentIOBOnly is explicitly false', () => {
            const inputs = makeInputs();
            const result = generate(inputs, false);

            expect(result).toHaveLength(48);
        });
    });

    // -----------------------------------------------------------------------
    // Time offsets in entries
    // -----------------------------------------------------------------------

    describe('time offsets', () => {
        it('spaces entries at 5-minute intervals from clock time', () => {
            const inputs = makeInputs();
            const result = generate(inputs);

            const clockMs = new Date(FIXED_TIME).getTime();

            for (let i = 0; i < result.length; i++) {
                const expectedMs = clockMs + i * 5 * MS_PER_MINUTE;
                expect(result[i].time.getTime()).toBe(expectedMs);
            }
        });

        it('first entry uses the clock time exactly', () => {
            const inputs = makeInputs();
            const result = generate(inputs, true);

            const clockMs = new Date(FIXED_TIME).getTime();
            expect(result[0].time.getTime()).toBe(clockMs);
        });
    });

    // -----------------------------------------------------------------------
    // Pre-computed treatments bypass calcTempTreatments
    // -----------------------------------------------------------------------

    describe('pre-computed treatments', () => {
        it('uses provided treatments directly and does not call calcTempTreatments', () => {
            const inputs = makeInputs();
            const treatments: IobTreatment[] = [
                {
                    insulin: 1.0,
                    date: FIXED_MS - MS_PER_HOUR,
                },
            ];

            generate(inputs, true, treatments);

            expect(calcTempTreatments).not.toHaveBeenCalled();
        });

        it('calls calcTempTreatments twice when no treatments provided', () => {
            const inputs = makeInputs();

            generate(inputs, true);

            // Once for normal treatments, once with zeroTempDuration=240
            expect(calcTempTreatments).toHaveBeenCalledTimes(2);
            expect(calcTempTreatments).toHaveBeenCalledWith(inputs);
            expect(calcTempTreatments).toHaveBeenCalledWith(inputs, 240);
        });

        it('sets treatmentsWithZeroTemp to empty array when treatments are provided', () => {
            const inputs = makeInputs();
            const treatments: IobTreatment[] = [
                {
                    insulin: 1.0,
                    date: FIXED_MS - MS_PER_HOUR,
                },
            ];

            const result = generate(inputs, true, treatments);

            // The iobWithZeroTemp should be computed from empty treatments,
            // so iobTotal should be called for both the main and zero-temp
            // paths at each time point
            expect(iobTotal).toHaveBeenCalled();

            // iobWithZeroTemp entry should exist on result
            expect(result[0]).toHaveProperty('iobWithZeroTemp');
        });
    });

    // -----------------------------------------------------------------------
    // Each entry has required fields
    // -----------------------------------------------------------------------

    describe('entry fields', () => {
        it('each entry has iob, activity, basaliob, bolusiob, netbasalinsulin, bolusinsulin, time, iobWithZeroTemp', () => {
            const inputs = makeInputs();
            const result = generate(inputs);

            for (const entry of result) {
                expect(typeof entry.iob).toBe('number');
                expect(typeof entry.activity).toBe('number');
                expect(typeof entry.basaliob).toBe('number');
                expect(typeof entry.bolusiob).toBe('number');
                expect(typeof entry.netbasalinsulin).toBe('number');
                expect(typeof entry.bolusinsulin).toBe('number');
                expect(entry.time).toBeInstanceOf(Date);
                expect(entry.iobWithZeroTemp).toBeDefined();
            }
        });
    });

    // -----------------------------------------------------------------------
    // First entry has lastBolusTime and lastTemp
    // -----------------------------------------------------------------------

    describe('first entry annotations', () => {
        it('first entry has lastBolusTime and lastTemp', () => {
            const bolusTime = FIXED_MS - 30 * MS_PER_MINUTE;
            const lastTemp: IobTreatment = {
                date: FIXED_MS - 10 * MS_PER_MINUTE,
                rate: 0.5,
                duration: 30,
                started_at: new Date(FIXED_MS - 10 * MS_PER_MINUTE),
            };

            (findLastBolusAndTemp as Mock).mockReturnValue({
                lastBolusTime: bolusTime,
                lastTemp,
            });

            const inputs = makeInputs();
            const result = generate(inputs);

            expect(result[0].lastBolusTime).toBe(bolusTime);
            expect(result[0].lastTemp).toBe(lastTemp);
        });

        it('subsequent entries do not have lastBolusTime or lastTemp set by generate', () => {
            (findLastBolusAndTemp as Mock).mockReturnValue({
                lastBolusTime: FIXED_MS - MS_PER_HOUR,
                lastTemp: {
                    date: FIXED_MS - MS_PER_HOUR,
                    rate: 1.0,
                    duration: 30,
                },
            });

            const inputs = makeInputs();
            const result = generate(inputs);

            // Second entry onward should not have these annotations
            // (the mock for iobTotal does not produce them, and generate only sets them on index 0)
            for (let i = 1; i < result.length; i++) {
                expect(result[i].lastBolusTime).toBeUndefined();
                expect(result[i].lastTemp).toBeUndefined();
            }
        });
    });

    // -----------------------------------------------------------------------
    // Autosens passthrough
    // -----------------------------------------------------------------------

    describe('autosens passthrough', () => {
        it('passes autosens to opts when provided in inputs', () => {
            const autosens = { ratio: 1.1 };
            const inputs = makeInputs({ autosens });

            generate(inputs, true);

            // iobTotal is called twice per iteration (once for main, once for zero-temp)
            // The first call should have autosens in opts
            const firstCall = (iobTotal as Mock).mock.calls[0];
            const opts = firstCall[0];
            expect(opts.autosens).toEqual({ ratio: 1.1 });
        });

        it('does not include autosens in opts when not provided in inputs', () => {
            const inputs = makeInputs();

            generate(inputs, true);

            const firstCall = (iobTotal as Mock).mock.calls[0];
            const opts = firstCall[0];
            expect(opts.autosens).toBeUndefined();
        });

        it('does not attach autosens to the zero-temp opts', () => {
            const autosens = { ratio: 0.9 };
            const inputs = makeInputs({ autosens });

            generate(inputs, true);

            // The second call to iobTotal is for the zero-temp computation
            const secondCall = (iobTotal as Mock).mock.calls[1];
            const zeroTempOpts = secondCall[0];
            expect(zeroTempOpts.autosens).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // Single bolus treatment produces non-zero IOB
    // -----------------------------------------------------------------------

    describe('single bolus treatment', () => {
        it('produces non-zero IOB when iobTotal returns non-zero values', () => {
            const treatments: IobTreatment[] = [
                {
                    insulin: 2.0,
                    date: FIXED_MS - MS_PER_HOUR,
                    started_at: new Date(FIXED_MS - MS_PER_HOUR),
                },
            ];

            // Make iobTotal return non-zero for main computation
            (iobTotal as Mock).mockImplementation((_opts: unknown, time: Date) => ({
                iob: 1.5,
                activity: 0.02,
                basaliob: 0,
                bolusiob: 1.5,
                netbasalinsulin: 0,
                bolusinsulin: 2.0,
                time,
            }));

            const inputs = makeInputs();
            const result = generate(inputs, true, treatments);

            expect(result[0].iob).toBe(1.5);
            expect(result[0].activity).toBe(0.02);
            expect(result[0].bolusiob).toBe(1.5);
            expect(result[0].bolusinsulin).toBe(2.0);
        });
    });

    // -----------------------------------------------------------------------
    // Clock timezone validation
    // -----------------------------------------------------------------------

    describe('clock timezone validation', () => {
        it('does not log a warning for zoned clock (Z suffix)', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const inputs = makeInputs({ clock: '2025-01-15T12:00:00.000Z' });

            generate(inputs, true);

            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('does not log a warning for clock with offset timezone', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const inputs = makeInputs({ clock: '2025-01-15T12:00:00.000-05:00' });

            generate(inputs, true);

            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });

        it('logs a warning for unzoned clock', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const inputs = makeInputs({ clock: '2025-01-15T12:00:00.000' });

            generate(inputs, true);

            expect(consoleSpy).toHaveBeenCalledTimes(1);
            expect(consoleSpy.mock.calls[0][0]).toContain('unzoned');
            consoleSpy.mockRestore();
        });
    });

    // -----------------------------------------------------------------------
    // iobTotal call count
    // -----------------------------------------------------------------------

    describe('iobTotal call count', () => {
        it('calls iobTotal twice per time point (main + zero-temp)', () => {
            const inputs = makeInputs();

            generate(inputs, true);

            // 1 iteration * 2 calls per iteration = 2
            expect(iobTotal).toHaveBeenCalledTimes(2);
        });

        it('calls iobTotal 96 times for full 48-entry timeline', () => {
            const inputs = makeInputs();

            generate(inputs);

            // 48 iterations * 2 calls per iteration = 96
            expect(iobTotal).toHaveBeenCalledTimes(96);
        });
    });

    // -----------------------------------------------------------------------
    // findLastBolusAndTemp is called with treatments
    // -----------------------------------------------------------------------

    describe('findLastBolusAndTemp integration', () => {
        it('calls findLastBolusAndTemp with the treatments array', () => {
            const treatments: IobTreatment[] = [
                {
                    insulin: 1.0,
                    date: FIXED_MS - MS_PER_HOUR,
                    started_at: new Date(FIXED_MS - MS_PER_HOUR),
                },
            ];
            const inputs = makeInputs();

            generate(inputs, true, treatments);

            expect(findLastBolusAndTemp).toHaveBeenCalledTimes(1);
            expect(findLastBolusAndTemp).toHaveBeenCalledWith(treatments);
        });

        it('calls findLastBolusAndTemp with computed treatments when none provided', () => {
            const computedTreatments: IobTreatment[] = [
                {
                    insulin: 0.5,
                    date: FIXED_MS - 2 * MS_PER_HOUR,
                },
            ];
            (calcTempTreatments as Mock).mockReturnValue(computedTreatments);

            const inputs = makeInputs();

            generate(inputs, true);

            expect(findLastBolusAndTemp).toHaveBeenCalledWith(computedTreatments);
        });
    });

    // -----------------------------------------------------------------------
    // Profile is passed through to opts
    // -----------------------------------------------------------------------

    describe('profile passthrough', () => {
        it('passes the profile from inputs to iobTotal opts', () => {
            const profile = makeProfile({ dia: 8 });
            const inputs = makeInputs({ profile });

            generate(inputs, true);

            const firstCall = (iobTotal as Mock).mock.calls[0];
            const opts = firstCall[0];
            expect(opts.profile).toBe(profile);
        });
    });
});
