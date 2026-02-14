import { describe, it, expect } from 'vitest';
import { calcTempTreatments } from '../../../src/iob/extractTreatments';
import type { PumpHistoryEvent } from '../../../src/types/index';
import type { IobTreatment } from '../../../src/iob/types';
import {
    FIXED_TIME,
    FIXED_MS,
    MS_PER_MINUTE,
    makeIobProfile,
    makeIobInputs,
} from '../helpers/factories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBolusEvent(
    timestamp: string,
    amount: number,
): PumpHistoryEvent {
    return {
        _type: 'Bolus',
        timestamp,
        amount,
    } as PumpHistoryEvent;
}

function makeTempBasalPair(
    timestamp: string,
    rate: number,
    durationMin: number,
): PumpHistoryEvent[] {
    return [
        {
            _type: 'TempBasalDuration',
            timestamp,
            'duration (min)': durationMin,
        } as unknown as PumpHistoryEvent,
        {
            _type: 'TempBasal',
            timestamp,
            rate,
            temp: 'absolute',
        } as PumpHistoryEvent,
    ];
}

describe('calcTempTreatments', () => {

    // -----------------------------------------------------------------------
    // Empty / minimal input
    // -----------------------------------------------------------------------

    it('returns empty array for empty history', () => {
        const result = calcTempTreatments(makeIobInputs());
        expect(result).toEqual([]);
    });

    it('returns empty array when history is empty and history24 is also empty', () => {
        const result = calcTempTreatments(makeIobInputs({ history24: [] }));
        expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Single bolus event
    // -----------------------------------------------------------------------

    it('produces a bolus treatment from a single Bolus event', () => {
        const bolusTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [makeBolusEvent(bolusTime, 2.5)],
        });
        const result = calcTempTreatments(inputs);

        // The bolus should appear in the output
        const bolusTreatments = result.filter(t => t.insulin === 2.5);
        expect(bolusTreatments).toHaveLength(1);
        expect(bolusTreatments[0].date).toBe(new Date(bolusTime).getTime());
    });

    // -----------------------------------------------------------------------
    // Single temp basal event
    // -----------------------------------------------------------------------

    it('produces treatments from a single temp basal event', () => {
        const tempTime = '2025-01-15T11:00:00.000Z';
        const inputs = makeIobInputs({
            history: makeTempBasalPair(tempTime, 2.0, 30),
        });
        const result = calcTempTreatments(inputs);

        // Should include the raw temp event and net basal bolus treatments
        expect(result.length).toBeGreaterThan(0);

        // The raw temp event (rate=2.0) should be in the output
        const rawTemps = result.filter(t => t.rate === 2.0);
        expect(rawTemps.length).toBeGreaterThanOrEqual(1);
    });

    it('net basal treatments reflect temp rate minus profile basal', () => {
        // rate=2.0, current_basal=1.0 => net = 1.0 U/hr
        // With a 30min temp, net amount = round(1.0 * 30 * 10/6) / 100 = 0.5
        // tempBolusCount = round(0.5 / 0.05) = 10 micro-boluses of 0.05U
        const tempTime = '2025-01-15T11:00:00.000Z';
        const inputs = makeIobInputs({
            history: makeTempBasalPair(tempTime, 2.0, 30),
            profile: makeIobProfile({ current_basal: 1.0 }),
        });
        const result = calcTempTreatments(inputs);

        const microBoluses = result.filter(t => t.insulin === 0.05);
        expect(microBoluses.length).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // history24 merge
    // -----------------------------------------------------------------------

    it('merges history24 events with history', () => {
        const bolusTime1 = '2025-01-15T11:50:00.000Z';
        const bolusTime2 = '2025-01-15T11:40:00.000Z';
        const inputs = makeIobInputs({
            history: [makeBolusEvent(bolusTime1, 1.0)],
            history24: [makeBolusEvent(bolusTime2, 2.0)],
        });
        const result = calcTempTreatments(inputs);

        // Both boluses should be present
        const boluses = result.filter(
            t => t.insulin === 1.0 || t.insulin === 2.0,
        );
        expect(boluses).toHaveLength(2);
    });

    it('does not merge history24 when it is undefined', () => {
        const bolusTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [makeBolusEvent(bolusTime, 3.0)],
            // history24 intentionally omitted
        });
        const result = calcTempTreatments(inputs);

        const boluses = result.filter(t => t.insulin === 3.0);
        expect(boluses).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // zeroTempDuration pass-through
    // -----------------------------------------------------------------------

    it('passes zeroTempDuration to cancel temp creation', () => {
        const bolusTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [makeBolusEvent(bolusTime, 1.0)],
        });

        // With zeroTempDuration=240
        const withDuration = calcTempTreatments(inputs, 240);
        const cancelTemps240 = withDuration.filter(
            t => t.rate === 0 && t.duration === 240,
        );
        expect(cancelTemps240.length).toBeGreaterThanOrEqual(1);

        // Without zeroTempDuration
        const withoutDuration = calcTempTreatments(
            makeIobInputs({ history: [makeBolusEvent(bolusTime, 1.0)] }),
        );
        const cancelTemps0 = withoutDuration.filter(
            t => t.rate === 0 && t.duration === 0,
        );
        expect(cancelTemps0.length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // Overlapping temp events have durations trimmed
    // -----------------------------------------------------------------------

    it('trims overlapping temp event durations', () => {
        // Two temp basals: first starts at 11:00 for 60 min, second at 11:30
        // The first should be trimmed to 30 min duration
        const temp1Time = '2025-01-15T11:00:00.000Z';
        const temp2Time = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [
                // Events are listed newest-first (pump order)
                ...makeTempBasalPair(temp2Time, 1.5, 30),
                ...makeTempBasalPair(temp1Time, 2.0, 60),
            ],
        });
        const result = calcTempTreatments(inputs);

        // The first temp should appear in the output with its original rate
        // but the overlap-trim logic should have shortened it
        const tempsAtRate2 = result.filter(
            t => t.rate === 2.0 && t.duration !== undefined,
        );
        // The trimmed temp event should have duration <= 30
        // (the time gap between the two events)
        for (const t of tempsAtRate2) {
            expect(t.duration).toBeLessThanOrEqual(30);
        }
    });

    // -----------------------------------------------------------------------
    // AndroidAPS cancel TBR splice (null duration)
    // -----------------------------------------------------------------------

    it('splices out overlapping AndroidAPS cancel TBR records with null duration', () => {
        // An AndroidAPS "Cancel TBR" event has eventType="Temp Basal" with
        // duration=null. When it overlaps with a preceding temp, the overlap
        // trim code (line 56-58) should splice it out of tempHistory.
        const temp1Time = '2025-01-15T11:00:00.000Z';
        const cancelTime = '2025-01-15T11:15:00.000Z';
        const inputs = makeIobInputs({
            history: [
                // AndroidAPS cancel TBR: eventType Temp Basal, null duration
                // Must come first (newest) in pump-history order
                {
                    eventType: 'Temp Basal',
                    timestamp: cancelTime,
                    rate: 0,
                    duration: null,
                } as unknown as PumpHistoryEvent,
                // Regular temp basal: overlaps cancel because 11:00 + 30min > 11:15
                {
                    eventType: 'Temp Basal',
                    timestamp: temp1Time,
                    rate: 2.0,
                    duration: 30,
                } as unknown as PumpHistoryEvent,
            ],
        });
        const result = calcTempTreatments(inputs);

        // The cancel TBR record with null duration should have been spliced
        // out. The remaining temp event at rate=2.0 should be trimmed to 15
        // minutes (the gap before the cancel arrived).
        const rawTemps = result.filter(
            t => t.rate === 2.0 && t.duration !== undefined,
        );
        expect(rawTemps.length).toBeGreaterThanOrEqual(1);
        for (const t of rawTemps) {
            expect(t.duration).toBeLessThanOrEqual(15);
        }
    });

    // -----------------------------------------------------------------------
    // suspend_zeros_iob path
    // -----------------------------------------------------------------------

    it('processes pump suspends when suspend_zeros_iob is true', () => {
        const suspendTime = '2025-01-15T11:00:00.000Z';
        const resumeTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [
                {
                    _type: 'PumpResume',
                    timestamp: resumeTime,
                } as PumpHistoryEvent,
                {
                    _type: 'PumpSuspend',
                    timestamp: suspendTime,
                } as PumpHistoryEvent,
            ],
            profile: makeIobProfile({ suspend_zeros_iob: true }),
        });
        const result = calcTempTreatments(inputs);

        // When suspend_zeros_iob is true, the function creates zero-rate
        // SuspendBasal temp events to negate profile basal during suspends.
        // These get converted to net basal boluses (negative micro-boluses).
        const negativeBoluses = result.filter(
            t => t.insulin !== undefined && t.insulin < 0,
        );
        expect(negativeBoluses.length).toBeGreaterThan(0);
    });

    it('does not process suspends when suspend_zeros_iob is false', () => {
        const suspendTime = '2025-01-15T11:00:00.000Z';
        const resumeTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: [
                {
                    _type: 'PumpResume',
                    timestamp: resumeTime,
                } as PumpHistoryEvent,
                {
                    _type: 'PumpSuspend',
                    timestamp: suspendTime,
                } as PumpHistoryEvent,
            ],
            profile: makeIobProfile({ suspend_zeros_iob: false }),
        });
        const result = calcTempTreatments(inputs);

        // Without suspend_zeros_iob, no SuspendBasal events are created
        // so there should be no negative micro-boluses from suspend handling
        const suspendBasals = result.filter(t => t.rate === 0 && t.duration !== undefined && t.duration > 0);
        // There should be no suspend-created zero-rate basals with substantial duration
        // (cancel temps have rate=0 but start in the future, 1 min after "now")
        const suspendZeroBasals = suspendBasals.filter(
            t => t.date < FIXED_MS,
        );
        expect(suspendZeroBasals).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Basalprofile splitting
    // -----------------------------------------------------------------------

    it('splits temp basals at basal profile boundaries', () => {
        // basalprofile has a boundary at 720 minutes (12:00)
        // A temp basal spanning 11:30 to 12:30 should be split at that boundary
        const tempTime = '2025-01-15T11:30:00.000Z';
        const inputs = makeIobInputs({
            history: makeTempBasalPair(tempTime, 2.0, 60),
            profile: makeIobProfile({
                current_basal: 1.0,
                basalprofile: [
                    {
                        i: 0,
                        start: '00:00:00',
                        rate: 1.0,
                        minutes: 0,
                    },
                    {
                        i: 1,
                        start: '12:00:00',
                        rate: 1.5,
                        minutes: 720,
                    },
                ],
            }),
        });
        const result = calcTempTreatments(inputs);

        // The temp at rate=2.0 should be present; the splitting happens
        // internally and produces net basal boluses reflecting the two
        // different profile basals on either side of the boundary
        expect(result.length).toBeGreaterThan(0);

        // Verify that the raw temp event in the result has been processed
        const rawTemps = result.filter(
            t => t.rate === 2.0 && t.duration !== undefined,
        );
        expect(rawTemps.length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // Output sorting
    // -----------------------------------------------------------------------

    it('returns all treatments sorted by date', () => {
        const bolusTime = '2025-01-15T11:50:00.000Z';
        const tempTime = '2025-01-15T11:00:00.000Z';
        const inputs = makeIobInputs({
            history: [
                makeBolusEvent(bolusTime, 1.0),
                ...makeTempBasalPair(tempTime, 2.0, 30),
            ],
        });
        const result = calcTempTreatments(inputs);

        // Verify output is sorted ascending by date
        for (let i = 1; i < result.length; i++) {
            expect(result[i].date).toBeGreaterThanOrEqual(result[i - 1].date);
        }
    });

    // -----------------------------------------------------------------------
    // Autosens pass-through
    // -----------------------------------------------------------------------

    it('passes autosens ratio through to net basal conversion', () => {
        const tempTime = '2025-01-15T11:00:00.000Z';

        // With autosens ratio=1.5, profile basal is adjusted up:
        // effective basal = 1.0 * 1.5 = 1.5
        // net rate = 2.0 - 1.5 = 0.5 (less net insulin)
        const inputsWithAutosens = makeIobInputs({
            history: makeTempBasalPair(tempTime, 2.0, 30),
            profile: makeIobProfile({ current_basal: 1.0 }),
            autosens: { ratio: 1.5 },
        });
        const withAutosens = calcTempTreatments(inputsWithAutosens);

        // Without autosens, net rate = 2.0 - 1.0 = 1.0 (more net insulin)
        const inputsNoAutosens = makeIobInputs({
            history: makeTempBasalPair(tempTime, 2.0, 30),
            profile: makeIobProfile({ current_basal: 1.0 }),
        });
        const withoutAutosens = calcTempTreatments(inputsNoAutosens);

        // The autosens-adjusted result should have fewer positive micro-boluses
        const positiveBoluses = (treatments: IobTreatment[]) =>
            treatments.filter(t => t.insulin === 0.05).length;

        expect(positiveBoluses(withAutosens)).toBeLessThan(
            positiveBoluses(withoutAutosens),
        );
    });

    // -----------------------------------------------------------------------
    // Combined boluses and temps
    // -----------------------------------------------------------------------

    it('includes both bolus treatments and net basal treatments in output', () => {
        const bolusTime = '2025-01-15T11:45:00.000Z';
        const tempTime = '2025-01-15T11:00:00.000Z';
        const inputs = makeIobInputs({
            history: [
                makeBolusEvent(bolusTime, 5.0),
                ...makeTempBasalPair(tempTime, 2.0, 30),
            ],
        });
        const result = calcTempTreatments(inputs);

        // Should have the original bolus
        const boluses = result.filter(t => t.insulin === 5.0);
        expect(boluses).toHaveLength(1);

        // Should have net basal micro-boluses
        const microBoluses = result.filter(
            t => t.insulin === 0.05 || t.insulin === -0.05,
        );
        expect(microBoluses.length).toBeGreaterThan(0);

        // Should also include the raw temp event
        const rawTemps = result.filter(t => t.rate !== undefined);
        expect(rawTemps.length).toBeGreaterThan(0);
    });
});
