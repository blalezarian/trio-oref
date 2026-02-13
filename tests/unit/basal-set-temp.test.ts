import { describe, it, expect, vi, beforeEach } from 'vitest';
import tempBasalFunctions, {
    getMaxSafeBasal,
    setTempBasal,
    appendReason,
    resolveMultiplier,
    isCurrentTempAcceptable,
} from '../../src/set-temp-basal/index';
import type { TempBasalProfile, TempBasalResult, CurrentTemp } from '../../src/set-temp-basal/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<TempBasalProfile> = {}): TempBasalProfile {
    return {
        current_basal: 1.0,
        max_daily_basal: 2.0,
        max_basal: 5.0,
        max_daily_safety_multiplier: 3,
        current_basal_safety_multiplier: 4,
        ...overrides,
    };
}

function makeResult(overrides: Partial<TempBasalResult> = {}): TempBasalResult {
    return {
        reason: '',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// resolveMultiplier
// ---------------------------------------------------------------------------

describe('resolveMultiplier', () => {
    it('returns the value when it is a valid number', () => {
        expect(resolveMultiplier(5, 3)).toBe(5);
    });

    it('returns the default when value is null', () => {
        expect(resolveMultiplier(null, 3)).toBe(3);
    });

    it('returns the default when value is NaN', () => {
        expect(resolveMultiplier(NaN, 4)).toBe(4);
    });

    it('returns 0 when value is 0 (not null/NaN)', () => {
        expect(resolveMultiplier(0, 3)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// isCurrentTempAcceptable
// ---------------------------------------------------------------------------

describe('isCurrentTempAcceptable', () => {
    it('returns true when current temp is within all tolerances', () => {
        const currenttemp: CurrentTemp = { duration: 25, rate: 2.0 };
        // suggestedRate 2.0 is within [2.0*0.8, 2.0*1.2] = [1.6, 2.4]
        // duration 25 > (30 - 10) = 20, and 25 <= 120
        expect(isCurrentTempAcceptable(currenttemp, 2.0, 30)).toBe(true);
    });

    it('returns false when suggested rate is above high tolerance', () => {
        const currenttemp: CurrentTemp = { duration: 25, rate: 1.0 };
        // suggestedRate 2.0 > 1.0 * 1.2 = 1.2
        expect(isCurrentTempAcceptable(currenttemp, 2.0, 30)).toBe(false);
    });

    it('returns false when suggested rate is below low tolerance', () => {
        const currenttemp: CurrentTemp = { duration: 25, rate: 3.0 };
        // suggestedRate 2.0 < 3.0 * 0.8 = 2.4
        expect(isCurrentTempAcceptable(currenttemp, 2.0, 30)).toBe(false);
    });

    it('returns false when duration is 0 (no temp requested)', () => {
        const currenttemp: CurrentTemp = { duration: 25, rate: 2.0 };
        expect(isCurrentTempAcceptable(currenttemp, 2.0, 0)).toBe(false);
    });

    it('returns false when current temp duration is too short', () => {
        const currenttemp: CurrentTemp = { duration: 15, rate: 2.0 };
        // 15 > (30 - 10) = 20 → false
        expect(isCurrentTempAcceptable(currenttemp, 2.0, 30)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// appendReason
// ---------------------------------------------------------------------------

describe('appendReason', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('appends message to empty reason', () => {
        const requestedTempBasalResult = makeResult();
        appendReason(requestedTempBasalResult, 'test message');
        expect(requestedTempBasalResult.reason).toBe('test message');
    });

    it('appends message with separator to existing reason', () => {
        const requestedTempBasalResult = makeResult({ reason: 'first' });
        appendReason(requestedTempBasalResult, 'second');
        expect(requestedTempBasalResult.reason).toBe('first. second');
    });

    it('logs message to console.log', () => {
        const requestedTempBasalResult = makeResult();
        appendReason(requestedTempBasalResult, 'logged message');
        expect(console.log).toHaveBeenCalledWith('logged message');
    });
});

// ---------------------------------------------------------------------------
// getMaxSafeBasal
// ---------------------------------------------------------------------------

describe('getMaxSafeBasal', () => {
    it('returns the overall minimum of the three constraints', () => {
        // max_basal=5, 3*2=6, 4*1=4 => min is 4
        const profile = makeProfile();
        expect(getMaxSafeBasal(profile)).toBe(4);
    });

    it('max_basal is limiting', () => {
        const profile = makeProfile({
            max_basal: 2,
            max_daily_basal: 3,
            max_daily_safety_multiplier: 3,
            current_basal: 3,
            current_basal_safety_multiplier: 4,
        });
        expect(getMaxSafeBasal(profile)).toBe(2);
    });

    it('daily safety multiplier is limiting', () => {
        const profile = makeProfile({
            max_basal: 10,
            max_daily_basal: 1,
            max_daily_safety_multiplier: 2,
            current_basal: 3,
            current_basal_safety_multiplier: 4,
        });
        expect(getMaxSafeBasal(profile)).toBe(2);
    });

    it('current basal multiplier is limiting', () => {
        const profile = makeProfile({
            max_basal: 10,
            max_daily_basal: 5,
            max_daily_safety_multiplier: 3,
            current_basal: 0.5,
            current_basal_safety_multiplier: 2,
        });
        expect(getMaxSafeBasal(profile)).toBe(1);
    });

    it('uses default multiplier (3) when max_daily is null', () => {
        const profile = makeProfile({
            max_basal: 10,
            max_daily_basal: 2,
            max_daily_safety_multiplier: null,
            current_basal: 2,
            current_basal_safety_multiplier: 4,
        });
        expect(getMaxSafeBasal(profile)).toBe(6);
    });

    it('uses default multiplier (4) when current_basal is null', () => {
        const profile = makeProfile({
            max_basal: 10,
            max_daily_basal: 3,
            max_daily_safety_multiplier: 3,
            current_basal: 2,
            current_basal_safety_multiplier: null,
        });
        expect(getMaxSafeBasal(profile)).toBe(8);
    });

    it('uses both defaults when both multipliers are null', () => {
        const profile = makeProfile({
            max_basal: 10,
            max_daily_basal: 2,
            max_daily_safety_multiplier: null,
            current_basal: 1,
            current_basal_safety_multiplier: null,
        });
        expect(getMaxSafeBasal(profile)).toBe(4);
    });

    it('works via tempBasalFunctions object (default export)', () => {
        const profile = makeProfile();
        expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// setTempBasal
// ---------------------------------------------------------------------------

describe('setTempBasal', () => {

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('clamps a negative rate to 0', () => {
        const profile = makeProfile({ current_basal: 1.0 });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(-0.5, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(0);
        expect(result.duration).toBe(30);
    });

    it('clamps rate to maxSafeBasal when rate exceeds it', () => {
        const profile = makeProfile({
            max_basal: 5,
            max_daily_basal: 2,
            max_daily_safety_multiplier: 3,
            current_basal: 1,
            current_basal_safety_multiplier: 4,
        });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(10, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(4);
        expect(result.duration).toBe(30);
    });

    it('does not change temp when current is within tolerance', () => {
        const profile = makeProfile();
        const requestedTempBasalResult = makeResult({ reason: 'test' });
        const currenttemp: CurrentTemp = { duration: 25, rate: 2.0 };
        const result = setTempBasal(2.0, 30, profile, requestedTempBasalResult, currenttemp);

        expect(result.rate).toBeUndefined();
        expect(result.duration).toBeUndefined();
        expect(result.reason).toContain('no temp required');
    });

    it('cancels active temp when suggested rate matches profile rate and skip_neutral_temps', () => {
        const profile = makeProfile({ current_basal: 1.0, skip_neutral_temps: true });
        const requestedTempBasalResult = makeResult();
        const currenttemp: CurrentTemp = { duration: 20, rate: 1.5 };
        const result = setTempBasal(1.0, 30, profile, requestedTempBasalResult, currenttemp);

        expect(result.rate).toBe(0);
        expect(result.duration).toBe(0);
        expect(result.reason).toContain('canceling current temp');
    });

    it('does nothing when no temp active and skip_neutral_temps', () => {
        const profile = makeProfile({ current_basal: 1.0, skip_neutral_temps: true });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(1.0, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBeUndefined();
        expect(result.duration).toBeUndefined();
        expect(result.reason).toContain('doing nothing');
    });

    it('does nothing when currenttemp has zero duration and skip_neutral_temps', () => {
        const profile = makeProfile({ current_basal: 1.0, skip_neutral_temps: true });
        const requestedTempBasalResult = makeResult();
        const currenttemp: CurrentTemp = { duration: 0, rate: 0 };
        const result = setTempBasal(1.0, 30, profile, requestedTempBasalResult, currenttemp);

        expect(result.rate).toBeUndefined();
        expect(result.duration).toBeUndefined();
        expect(result.reason).toContain('doing nothing');
    });

    it('sets neutral temp basal when skip_neutral_temps is false', () => {
        const profile = makeProfile({ current_basal: 1.0, skip_neutral_temps: false });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(1.0, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(1.0);
        expect(result.duration).toBe(30);
        expect(result.reason).toContain('Setting neutral temp basal');
    });

    it('sets the suggested rate and duration', () => {
        const profile = makeProfile({ current_basal: 1.0 });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(2.5, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(2.5);
        expect(result.duration).toBe(30);
    });

    it('rounds the rate via round_basal', () => {
        const profile = makeProfile({ current_basal: 1.0 });
        const requestedTempBasalResult = makeResult();
        const result = setTempBasal(0.33, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(0.35);
        expect(result.duration).toBe(30);
    });

    it('works via tempBasalFunctions object (default export)', () => {
        const profile = makeProfile({ current_basal: 1.0 });
        const requestedTempBasalResult = makeResult();
        const result = tempBasalFunctions.setTempBasal(2.5, 30, profile, requestedTempBasalResult);

        expect(result.rate).toBe(2.5);
        expect(result.duration).toBe(30);
    });
});
