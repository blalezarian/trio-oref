import { describe, it, expect } from 'vitest';
import { convertNetBasalsToTreatments } from '../../../src/iob/convertNetBasals';
import type { TempEvent } from '../../../src/iob/types';
import {
    FIXED_MS,
    MS_PER_MINUTE,
    makeIobProfile,
    makeTempEvent,
} from '../helpers/factories';

describe('convertNetBasalsToTreatments', () => {

    // -----------------------------------------------------------------------
    // Edge cases
    // -----------------------------------------------------------------------

    it('returns empty array for empty splitHistory', () => {
        const result = convertNetBasalsToTreatments([], makeIobProfile());
        expect(result).toEqual([]);
    });

    it('skips events with duration <= 0', () => {
        const events: TempEvent[] = [
            makeTempEvent({ duration: 0 }),
            makeTempEvent({ duration: -5 }),
        ];
        const result = convertNetBasalsToTreatments(events, makeIobProfile());
        expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Positive net basal (temp rate > profile basal)
    // -----------------------------------------------------------------------

    it('produces positive 0.05U boluses when temp rate > profile basal', () => {
        // rate=2.0, current_basal=1.0 => netBasalRate = 1.0
        // duration=5 => netBasalAmount = round(1.0 * 5 * 10/6) / 100 = round(8.333) / 100 = 8/100 = 0.08
        // tempBolusSize = 0.05 (positive)
        // tempBolusCount = round(0.08 / 0.05) = round(1.6) = 2
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        expect(result.length).toBe(2);
        for (const bolus of result) {
            expect(bolus.insulin).toBe(0.05);
        }
    });

    it('produces negative -0.05U boluses when temp rate < profile basal', () => {
        // rate=0.5, current_basal=1.0 => netBasalRate = -0.5
        // duration=5 => netBasalAmount = round(-0.5 * 5 * 10/6) / 100 = round(-4.166) / 100 = -4/100 = -0.04
        // tempBolusSize = -0.05 (negative)
        // tempBolusCount = round(-0.04 / -0.05) = round(0.8) = 1
        const events: TempEvent[] = [makeTempEvent({ rate: 0.5, duration: 5 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        expect(result.length).toBe(1);
        for (const bolus of result) {
            expect(bolus.insulin).toBe(-0.05);
        }
    });

    // -----------------------------------------------------------------------
    // Bolus count and spacing
    // -----------------------------------------------------------------------

    it('computes correct bolus count from net basal amount formula', () => {
        // rate=3.0, current_basal=1.0 => netBasalRate = 2.0
        // duration=30 => netBasalAmount = round(2.0 * 30 * 10/6) / 100 = round(100) / 100 = 1.0
        // tempBolusSize = 0.05
        // tempBolusCount = round(1.0 / 0.05) = 20
        const events: TempEvent[] = [makeTempEvent({ rate: 3.0, duration: 30 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        expect(result.length).toBe(20);
    });

    it('spaces boluses evenly across the duration', () => {
        // rate=3.0, current_basal=1.0, duration=30
        // tempBolusCount = 20 (from above)
        // tempBolusSpacing = 30 / 20 = 1.5 minutes
        const events: TempEvent[] = [makeTempEvent({ rate: 3.0, duration: 30 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        const expectedSpacing = 1.5; // minutes
        for (let j = 0; j < result.length; j++) {
            const expectedDate = FIXED_MS + j * expectedSpacing * MS_PER_MINUTE;
            expect(result[j].date).toBe(expectedDate);
        }
    });

    it('sets created_at as a Date from the computed date', () => {
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        for (const bolus of result) {
            expect(bolus.created_at).toBeInstanceOf(Date);
            expect(bolus.created_at!.getTime()).toBe(bolus.date);
        }
    });

    // -----------------------------------------------------------------------
    // Zero net basal (temp rate == profile basal)
    // -----------------------------------------------------------------------

    it('produces zero boluses when temp rate equals profile basal', () => {
        // rate=1.0, current_basal=1.0 => netBasalRate = 0
        // netBasalAmount = 0, tempBolusCount = round(0 / 0.05) = 0
        const events: TempEvent[] = [makeTempEvent({ rate: 1.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Autosens ratio
    // -----------------------------------------------------------------------

    it('applies autosens_data.ratio to adjust profile basal rate', () => {
        // current_basal=1.0, autosens ratio=1.2 => adjusted currentRate = 1.2
        // rate=2.0 => netBasalRate = 2.0 - 1.2 = 0.8
        // duration=5 => netBasalAmount = round(0.8 * 5 * 10/6) / 100 = round(6.666) / 100 = 7/100 = 0.07
        // tempBolusSize = 0.05
        // tempBolusCount = round(0.07 / 0.05) = round(1.4) = 1
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(
            events,
            makeIobProfile({ current_basal: 1.0 }),
            { ratio: 1.2 },
        );

        expect(result.length).toBe(1);
        expect(result[0].insulin).toBe(0.05);
    });

    it('autosens ratio < 1 increases net basal for high temp rates', () => {
        // current_basal=1.0, autosens ratio=0.5 => adjusted currentRate = 0.5
        // rate=2.0 => netBasalRate = 2.0 - 0.5 = 1.5
        // duration=5 => netBasalAmount = round(1.5 * 5 * 10/6) / 100 = round(12.5) / 100 = 13/100 = 0.13
        // tempBolusSize = 0.05
        // tempBolusCount = round(0.13 / 0.05) = round(2.6) = 3
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(
            events,
            makeIobProfile({ current_basal: 1.0 }),
            { ratio: 0.5 },
        );

        expect(result.length).toBe(3);
        for (const bolus of result) {
            expect(bolus.insulin).toBe(0.05);
        }
    });

    // -----------------------------------------------------------------------
    // Exercise mode with high temp target
    // -----------------------------------------------------------------------

    it('exercise mode with high temp target adjusts sensitivity', () => {
        // target_bg = (min_bg + max_bg) / 2 = (120 + 120) / 2 = 120
        // normalTarget = 100, halfBasalTarget = 160
        // exercise_mode=true, temptargetSet=true, target_bg (120) >= 100 + 5 (105) => true
        // c = 160 - 100 = 60
        // sensitivityRatio = 60 / (60 + 120 - 100) = 60 / 80 = 0.75
        // adjusted currentRate = 1.0 * 0.75 = 0.75
        // rate=2.0 => netBasalRate = 2.0 - 0.75 = 1.25
        // duration=5 => netBasalAmount = round(1.25 * 5 * 10/6) / 100 = round(10.416) / 100 = 10/100 = 0.10
        // tempBolusSize = 0.05
        // tempBolusCount = round(0.10 / 0.05) = round(2) = 2
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(
            events,
            makeIobProfile({
                current_basal: 1.0,
                min_bg: 120,
                max_bg: 120,
                exercise_mode: true,
                temptargetSet: true,
            }),
        );

        expect(result.length).toBe(2);
        for (const bolus of result) {
            expect(bolus.insulin).toBe(0.05);
        }
    });

    it('exercise mode takes priority over autosens ratio', () => {
        // When exercise_mode conditions are met, autosens_data is ignored
        // target_bg = 120, sensitivityRatio = 0.75 (from exercise), NOT 1.5 from autosens
        // adjusted currentRate = 1.0 * 0.75 = 0.75
        // rate=2.0 => netBasalRate = 1.25
        // duration=5 => netBasalAmount = round(1.25 * 5 * 10/6) / 100 = 0.10
        // tempBolusCount = round(0.10 / 0.05) = 2
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const resultWithAutosens = convertNetBasalsToTreatments(
            events,
            makeIobProfile({
                current_basal: 1.0,
                min_bg: 120,
                max_bg: 120,
                exercise_mode: true,
                temptargetSet: true,
            }),
            { ratio: 1.5 },
        );

        // Should match exercise-only result, not autosens-adjusted result
        expect(resultWithAutosens.length).toBe(2);
    });

    it('exercise mode does not activate when target_bg < normalTarget + 5', () => {
        // target_bg = (100 + 100) / 2 = 100
        // 100 < 100 + 5 = 105 => exercise sensitivity NOT applied
        // Falls through to autosens_data.ratio = 1.2
        // adjusted currentRate = 1.0 * 1.2 = 1.2
        // rate=2.0 => netBasalRate = 0.8
        // duration=5 => netBasalAmount = round(0.8 * 5 * 10/6) / 100 = round(6.666) / 100 = 0.07
        // tempBolusCount = round(0.07 / 0.05) = round(1.4) = 1
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 5 })];
        const result = convertNetBasalsToTreatments(
            events,
            makeIobProfile({
                current_basal: 1.0,
                min_bg: 100,
                max_bg: 100,
                exercise_mode: true,
                temptargetSet: true,
            }),
            { ratio: 1.2 },
        );

        expect(result.length).toBe(1);
    });

    it('uses custom half_basal_exercise_target when provided', () => {
        // target_bg = 120, normalTarget = 100
        // half_basal_exercise_target = 200 (custom)
        // c = 200 - 100 = 100
        // sensitivityRatio = 100 / (100 + 120 - 100) = 100 / 120 = 0.8333...
        // adjusted currentRate = 1.0 * 0.8333 = 0.8333
        // rate=2.0 => netBasalRate = 2.0 - 0.8333 = 1.1666
        // duration=6 => netBasalAmount = round(1.1666 * 6 * 10/6) / 100 = round(11.666) / 100 = 12/100 = 0.12
        // tempBolusSize = 0.05
        // tempBolusCount = round(0.12 / 0.05) = round(2.4) = 2
        const events: TempEvent[] = [makeTempEvent({ rate: 2.0, duration: 6 })];
        const result = convertNetBasalsToTreatments(
            events,
            makeIobProfile({
                current_basal: 1.0,
                min_bg: 120,
                max_bg: 120,
                exercise_mode: true,
                temptargetSet: true,
                half_basal_exercise_target: 200,
            }),
        );

        expect(result.length).toBe(2);
    });

    // -----------------------------------------------------------------------
    // Multiple events
    // -----------------------------------------------------------------------

    it('processes multiple events and concatenates boluses', () => {
        const events: TempEvent[] = [
            makeTempEvent({ rate: 2.0, duration: 5, date: FIXED_MS }),
            makeTempEvent({ rate: 3.0, duration: 30, date: FIXED_MS + 5 * 60_000 }),
        ];
        const result = convertNetBasalsToTreatments(events, makeIobProfile({ current_basal: 1.0 }));

        // First event: tempBolusCount = 2 (from positive bolus test above)
        // Second event: tempBolusCount = 20 (from bolus count test above)
        expect(result.length).toBe(2 + 20);
    });
});
