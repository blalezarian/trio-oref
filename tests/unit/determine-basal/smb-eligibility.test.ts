import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isTimeInSMBDisabledWindow,
    logBWWarningIfFound,
    logBWWarningIfCarbs,
} from '../../../src/determineBasal/smbEligibility';
import type { MealData } from '../../../src/types/index';

// ---------------------------------------------------------------------------
// isTimeInSMBDisabledWindow
// ---------------------------------------------------------------------------

describe('isTimeInSMBDisabledWindow', () => {
    it('returns true for all-day disable (start=0, end=0)', () => {
        expect(isTimeInSMBDisabledWindow(12, 0, 0)).toBe(true);
        expect(isTimeInSMBDisabledWindow(0, 0, 0)).toBe(true);
    });

    it('returns true when current hour matches single-hour window (start=end)', () => {
        expect(isTimeInSMBDisabledWindow(10, 10, 10)).toBe(true);
    });

    it('returns false when current hour does not match single-hour window', () => {
        expect(isTimeInSMBDisabledWindow(11, 10, 10)).toBe(false);
    });

    it('returns true for normal range when hour is in [start, end)', () => {
        expect(isTimeInSMBDisabledWindow(10, 10, 14)).toBe(true);
        expect(isTimeInSMBDisabledWindow(12, 10, 14)).toBe(true);
        expect(isTimeInSMBDisabledWindow(13, 10, 14)).toBe(true);
    });

    it('returns false for normal range when hour is outside [start, end)', () => {
        expect(isTimeInSMBDisabledWindow(9, 10, 14)).toBe(false);
        expect(isTimeInSMBDisabledWindow(14, 10, 14)).toBe(false);
        expect(isTimeInSMBDisabledWindow(15, 10, 14)).toBe(false);
    });

    it('returns true for overnight range when hour >= start', () => {
        expect(isTimeInSMBDisabledWindow(22, 22, 6)).toBe(true);
        expect(isTimeInSMBDisabledWindow(23, 22, 6)).toBe(true);
        expect(isTimeInSMBDisabledWindow(0, 22, 6)).toBe(true);
        expect(isTimeInSMBDisabledWindow(5, 22, 6)).toBe(true);
    });

    it('returns false for overnight range when hour is in the gap', () => {
        expect(isTimeInSMBDisabledWindow(6, 22, 6)).toBe(false);
        expect(isTimeInSMBDisabledWindow(12, 22, 6)).toBe(false);
        expect(isTimeInSMBDisabledWindow(21, 22, 6)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// logBWWarningIfFound
// ---------------------------------------------------------------------------

describe('logBWWarningIfFound', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('logs the reason when bwFound is falsy', () => {
        logBWWarningIfFound({ bwFound: false } as MealData, 'SMB enabled');
        expect(console.log).toHaveBeenCalledWith('SMB enabled');
    });

    it('logs default BW warning when bwFound is true', () => {
        logBWWarningIfFound({ bwFound: true } as MealData, 'SMB enabled');
        expect(console.log).toHaveBeenCalledWith(
            'Warning: SMB enabled within 6h of using Bolus Wizard: be sure to easy bolus 30s before using Bolus Wizard',
        );
    });

    it('logs warningOverride when bwFound is true and override provided', () => {
        logBWWarningIfFound({ bwFound: true } as MealData, 'SMB enabled', 'Custom BW warning');
        expect(console.log).toHaveBeenCalledWith('Custom BW warning');
    });
});

// ---------------------------------------------------------------------------
// logBWWarningIfCarbs
// ---------------------------------------------------------------------------

describe('logBWWarningIfCarbs', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('logs the reason when bwCarbs is falsy', () => {
        logBWWarningIfCarbs({ bwCarbs: 0 } as MealData, 'SMB enabled for COB');
        expect(console.log).toHaveBeenCalledWith('SMB enabled for COB');
    });

    it('logs BW carbs warning when bwCarbs is truthy', () => {
        logBWWarningIfCarbs({ bwCarbs: 30 } as MealData, 'SMB enabled for COB');
        expect(console.log).toHaveBeenCalledWith(
            'Warning: SMB enabled with Bolus Wizard carbs: be sure to easy bolus 30s before using Bolus Wizard',
        );
    });
});
