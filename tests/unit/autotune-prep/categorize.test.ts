import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimOldTreatments, mergeUAMData } from '../../../src/autotune-prep/categorize';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// trimOldTreatments
// ---------------------------------------------------------------------------

describe('trimOldTreatments', () => {
    const TS = '2025-01-15T12:00:00.000Z';
    const TS_EARLY = '2025-01-15T11:00:00.000Z';
    const TS_LATE = '2025-01-15T13:00:00.000Z';

    function makeTreatment(timestamp: string) {
        return { timestamp, carbs: 20 } as Parameters<typeof trimOldTreatments>[0][number];
    }

    function makeBucket(date: number) {
        return { date } as Parameters<typeof trimOldTreatments>[1][number];
    }

    it('removes treatments older than oldest bucketed glucose', () => {
        const bgTime = new Date(TS).getTime();
        const treatments = [
            makeTreatment(TS_LATE),  // index 0 — kept (newer)
            makeTreatment(TS_EARLY), // index 1 — removed (older)
        ];
        const bucketedData = [makeBucket(bgTime)];
        trimOldTreatments(treatments, bucketedData);
        expect(treatments).toHaveLength(1);
        expect(treatments[0].timestamp).toBe(TS_LATE);
    });

    it('keeps treatments newer than oldest bucketed glucose', () => {
        const bgTime = new Date(TS_EARLY).getTime();
        const treatments = [
            makeTreatment(TS_LATE),
            makeTreatment(TS),
        ];
        const bucketedData = [makeBucket(bgTime)];
        trimOldTreatments(treatments, bucketedData);
        expect(treatments).toHaveLength(2);
    });

    it('does nothing with empty treatments', () => {
        const treatments: Parameters<typeof trimOldTreatments>[0] = [];
        const bucketedData = [makeBucket(Date.now())];
        trimOldTreatments(treatments, bucketedData);
        expect(treatments).toHaveLength(0);
    });

    it('does nothing with empty bucketed data', () => {
        const treatments = [makeTreatment(TS)];
        trimOldTreatments(treatments, []);
        expect(treatments).toHaveLength(1);
    });

    it('never removes index 0 (loop starts at i>0)', () => {
        const bgTime = new Date(TS).getTime();
        const treatments = [
            makeTreatment(TS_EARLY), // index 0 — never removed
        ];
        const bucketedData = [makeBucket(bgTime)];
        trimOldTreatments(treatments, bucketedData);
        expect(treatments).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// mergeUAMData
// ---------------------------------------------------------------------------

describe('mergeUAMData', () => {
    function makeDatum(deviation: number) {
        return {
            glucose: 100,
            date: Date.now(),
            dateString: '2025-01-15T12:00:00.000Z',
            avgDelta: 0,
            BGI: 0,
            deviation,
        } as Parameters<typeof mergeUAMData>[1][number];
    }

    it('merges UAM into basal when categorize_uam_as_basal is true', () => {
        const UAM = [makeDatum(1), makeDatum(2)];
        const result = mergeUAMData(true, [], [], [], UAM);
        expect(result.basalGlucoseData).toHaveLength(2);
    });

    it('merges UAM into basal when CSF > 12 (1h of carb absorption)', () => {
        const CSF = Array.from({ length: 13 }, (_, i) => makeDatum(i));
        const UAM = [makeDatum(1), makeDatum(2)];
        const result = mergeUAMData(false, CSF, [], [], UAM);
        expect(result.basalGlucoseData).toHaveLength(2);
    });

    it('adds UAM to basal and trims 50% when 2*basalLength < UAMLength', () => {
        const basal = [makeDatum(1)]; // 1 basal
        const UAM = [makeDatum(3), makeDatum(4), makeDatum(5)]; // 3 UAM
        // 2*1 < 3, so merge + trim 50%
        const result = mergeUAMData(false, [], [], basal, UAM);
        // 4 total, keep lowest 50% = 2
        expect(result.basalGlucoseData).toHaveLength(2);
        // sorted by deviation ascending, kept lowest 50%
        expect(result.basalGlucoseData[0].deviation).toBeLessThanOrEqual(
            result.basalGlucoseData[1].deviation
        );
    });

    it('adds UAM to ISF and trims 50% when 2*ISFLength < UAMLength and ISF < 10', () => {
        const ISF = [makeDatum(1)]; // 1 ISF
        const UAM = [makeDatum(3), makeDatum(4), makeDatum(5)]; // 3 UAM
        // 2*1 < 3 && 1 < 10
        const result = mergeUAMData(false, [], ISF, [], UAM);
        expect(result.ISFGlucoseData).toHaveLength(2);
    });

    it('moves CSF to ISF when too many deviations categorized as meals', () => {
        // 4*basalLength + ISFLength < CSFLength && ISFLength < 10
        const CSF = Array.from({ length: 20 }, (_, i) => makeDatum(i));
        const ISF = [makeDatum(1)]; // 1 ISF
        const basal = [makeDatum(1)]; // 1 basal
        // 4*1 + 1 = 5 < 20 && 1 < 10
        const result = mergeUAMData(false, CSF, ISF, basal, []);
        expect(result.CSFGlucoseData).toHaveLength(0);
        expect(result.ISFGlucoseData).toHaveLength(21); // 1 ISF + 20 CSF
    });

    it('returns arrays unchanged when no redistribution needed', () => {
        const CSF = [makeDatum(1)];
        const ISF = Array.from({ length: 15 }, (_, i) => makeDatum(i));
        const basal = Array.from({ length: 15 }, (_, i) => makeDatum(i));
        const UAM = [makeDatum(1)];
        const result = mergeUAMData(false, CSF, ISF, basal, UAM);
        expect(result.CSFGlucoseData).toHaveLength(1);
        expect(result.ISFGlucoseData).toHaveLength(15);
        expect(result.basalGlucoseData).toHaveLength(15);
    });
});
