import { describe, it, expect, vi, beforeEach } from 'vitest';
import tempBasalFunctions from '../../src/basal-set-temp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TempBasalProfile {
    current_basal: number;
    max_daily_basal: number;
    max_basal: number;
    max_daily_safety_multiplier: number | null;
    current_basal_safety_multiplier: number | null;
    skip_neutral_temps?: boolean;
    model?: string;
}

interface TempBasalResult {
    reason: string;
    duration?: number;
    rate?: number;
}

interface CurrentTemp {
    duration: number;
    rate: number;
}

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
// Tests: getMaxSafeBasal
// ---------------------------------------------------------------------------

describe('getMaxSafeBasal', () => {

    // -----------------------------------------------------------------------
    // Returns min of the three constraints
    // -----------------------------------------------------------------------

    describe('returns min of the three constraints', () => {
        it('returns the overall minimum when all three differ', () => {
            // max_basal=5, 3*2=6, 4*1=4 => min is 4
            const profile = makeProfile({
                max_basal: 5,
                max_daily_basal: 2,
                max_daily_safety_multiplier: 3,
                current_basal: 1,
                current_basal_safety_multiplier: 4,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Each constraint can be the limiting factor
    // -----------------------------------------------------------------------

    describe('each constraint can be the limiting factor', () => {
        it('max_basal is limiting', () => {
            // max_basal=2, 3*3=9, 4*3=12 => min is 2
            const profile = makeProfile({
                max_basal: 2,
                max_daily_basal: 3,
                max_daily_safety_multiplier: 3,
                current_basal: 3,
                current_basal_safety_multiplier: 4,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(2);
        });

        it('max_daily_safety_multiplier * max_daily_basal is limiting', () => {
            // max_basal=10, 2*1=2, 4*3=12 => min is 2
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 1,
                max_daily_safety_multiplier: 2,
                current_basal: 3,
                current_basal_safety_multiplier: 4,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(2);
        });

        it('current_basal_safety_multiplier * current_basal is limiting', () => {
            // max_basal=10, 3*5=15, 2*0.5=1 => min is 1
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 5,
                max_daily_safety_multiplier: 3,
                current_basal: 0.5,
                current_basal_safety_multiplier: 2,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Uses defaults when multipliers are null or NaN
    // -----------------------------------------------------------------------

    describe('uses defaults when multipliers are null or NaN', () => {
        it('uses default max_daily_safety_multiplier (3) when null', () => {
            // max_basal=10, default(3)*2=6, 4*2=8 => min is 6
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 2,
                max_daily_safety_multiplier: null,
                current_basal: 2,
                current_basal_safety_multiplier: 4,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(6);
        });

        it('uses default current_basal_safety_multiplier (4) when null', () => {
            // max_basal=10, 3*3=9, default(4)*2=8 => min is 8
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 3,
                max_daily_safety_multiplier: 3,
                current_basal: 2,
                current_basal_safety_multiplier: null,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(8);
        });

        it('uses default max_daily_safety_multiplier (3) when NaN', () => {
            // max_basal=10, default(3)*2=6, 4*2=8 => min is 6
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 2,
                max_daily_safety_multiplier: NaN as unknown as number,
                current_basal: 2,
                current_basal_safety_multiplier: 4,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(6);
        });

        it('uses default current_basal_safety_multiplier (4) when NaN', () => {
            // max_basal=10, 3*3=9, default(4)*2=8 => min is 8
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 3,
                max_daily_safety_multiplier: 3,
                current_basal: 2,
                current_basal_safety_multiplier: NaN as unknown as number,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(8);
        });

        it('uses both defaults when both multipliers are null', () => {
            // max_basal=10, default(3)*2=6, default(4)*1=4 => min is 4
            const profile = makeProfile({
                max_basal: 10,
                max_daily_basal: 2,
                max_daily_safety_multiplier: null,
                current_basal: 1,
                current_basal_safety_multiplier: null,
            });
            expect(tempBasalFunctions.getMaxSafeBasal(profile)).toBe(4);
        });
    });
});

// ---------------------------------------------------------------------------
// Tests: setTempBasal
// ---------------------------------------------------------------------------

describe('setTempBasal', () => {

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    // -----------------------------------------------------------------------
    // Negative rate clamped to 0
    // -----------------------------------------------------------------------

    describe('negative rate clamped to 0', () => {
        it('clamps a negative rate to 0', () => {
            const profile = makeProfile({ current_basal: 1.0 });
            const rT = makeResult();
            const result = tempBasalFunctions.setTempBasal(-0.5, 30, profile, rT);

            // Rate of 0 !== current_basal (1.0), so it sets the temp
            expect(result.rate).toBe(0);
            expect(result.duration).toBe(30);
        });
    });

    // -----------------------------------------------------------------------
    // Rate above max clamped to max
    // -----------------------------------------------------------------------

    describe('rate above max clamped to max', () => {
        it('clamps rate to maxSafeBasal when rate exceeds it', () => {
            // maxSafeBasal = min(5, 3*2, 4*1) = min(5, 6, 4) = 4
            const profile = makeProfile({
                max_basal: 5,
                max_daily_basal: 2,
                max_daily_safety_multiplier: 3,
                current_basal: 1,
                current_basal_safety_multiplier: 4,
            });
            const rT = makeResult();
            const result = tempBasalFunctions.setTempBasal(10, 30, profile, rT);

            // round_basal(4) for default pump = Math.round(4 * 20) / 20 = 4.0
            expect(result.rate).toBe(4);
            expect(result.duration).toBe(30);
        });
    });

    // -----------------------------------------------------------------------
    // Current temp within tolerance: no change needed
    // -----------------------------------------------------------------------

    describe('current temp within tolerance', () => {
        it('does not change temp when current is within rate and duration tolerance', () => {
            // maxSafeBasal = min(5, 3*2, 4*1) = 4
            // suggested rate = 2.0, currenttemp rate = 2.0 (within 0.8x-1.2x)
            // duration = 30, currenttemp.duration = 25 (> 30 - 10 = 20, <= 120)
            const profile = makeProfile();
            const rT = makeResult({ reason: 'test' });
            const currenttemp: CurrentTemp = { duration: 25, rate: 2.0 };
            const result = tempBasalFunctions.setTempBasal(2.0, 30, profile, rT, currenttemp);

            // Should return without setting rate or duration
            expect(result.rate).toBeUndefined();
            expect(result.duration).toBeUndefined();
            expect(result.reason).toContain('no temp required');
        });
    });

    // -----------------------------------------------------------------------
    // Suggested rate equals profile rate + skip_neutral_temps=true + active temp
    // -----------------------------------------------------------------------

    describe('suggested rate equals profile rate with skip_neutral_temps=true', () => {
        it('cancels active temp when suggested rate matches profile rate', () => {
            const profile = makeProfile({
                current_basal: 1.0,
                skip_neutral_temps: true,
            });
            const rT = makeResult();
            const currenttemp: CurrentTemp = { duration: 20, rate: 1.5 };
            const result = tempBasalFunctions.setTempBasal(1.0, 30, profile, rT, currenttemp);

            expect(result.rate).toBe(0);
            expect(result.duration).toBe(0);
            expect(result.reason).toContain('canceling current temp');
        });
    });

    // -----------------------------------------------------------------------
    // Suggested rate equals profile rate + skip_neutral_temps=true + no active temp
    // -----------------------------------------------------------------------

    describe('suggested rate equals profile rate with skip_neutral_temps=true and no active temp', () => {
        it('does nothing when no temp basal is active', () => {
            const profile = makeProfile({
                current_basal: 1.0,
                skip_neutral_temps: true,
            });
            const rT = makeResult();
            const result = tempBasalFunctions.setTempBasal(1.0, 30, profile, rT);

            // No rate or duration set — doing nothing
            expect(result.rate).toBeUndefined();
            expect(result.duration).toBeUndefined();
            expect(result.reason).toContain('doing nothing');
        });

        it('does nothing when currenttemp has zero duration', () => {
            const profile = makeProfile({
                current_basal: 1.0,
                skip_neutral_temps: true,
            });
            const rT = makeResult();
            const currenttemp: CurrentTemp = { duration: 0, rate: 0 };
            const result = tempBasalFunctions.setTempBasal(1.0, 30, profile, rT, currenttemp);

            expect(result.rate).toBeUndefined();
            expect(result.duration).toBeUndefined();
            expect(result.reason).toContain('doing nothing');
        });
    });

    // -----------------------------------------------------------------------
    // Suggested rate equals profile rate + skip_neutral_temps=false
    // -----------------------------------------------------------------------

    describe('suggested rate equals profile rate with skip_neutral_temps=false', () => {
        it('sets a neutral temp basal at the profile rate', () => {
            const profile = makeProfile({
                current_basal: 1.0,
                skip_neutral_temps: false,
            });
            const rT = makeResult();
            const result = tempBasalFunctions.setTempBasal(1.0, 30, profile, rT);

            expect(result.rate).toBe(1.0);
            expect(result.duration).toBe(30);
            expect(result.reason).toContain('Setting neutral temp basal');
        });
    });

    // -----------------------------------------------------------------------
    // Normal rate change: sets rate and duration
    // -----------------------------------------------------------------------

    describe('normal rate change', () => {
        it('sets the suggested rate and duration', () => {
            const profile = makeProfile({ current_basal: 1.0 });
            const rT = makeResult();
            const result = tempBasalFunctions.setTempBasal(2.5, 30, profile, rT);

            // round_basal(2.5) for default pump, rate >= 1 and < 10:
            // Math.round(2.5 * 20) / 20 = Math.round(50) / 20 = 2.5
            expect(result.rate).toBe(2.5);
            expect(result.duration).toBe(30);
        });

        it('rounds the rate via round_basal', () => {
            const profile = makeProfile({ current_basal: 1.0 });
            const rT = makeResult();
            // 0.33 for default pump (rate < 1):
            // Math.round(0.33 * 20) / 20 = Math.round(6.6) / 20 = 7/20 = 0.35
            const result = tempBasalFunctions.setTempBasal(0.33, 30, profile, rT);

            expect(result.rate).toBe(0.35);
            expect(result.duration).toBe(30);
        });
    });
});
