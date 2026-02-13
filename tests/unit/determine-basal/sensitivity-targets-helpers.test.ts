import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateTempTargetSensitivityRatio,
    adjustBasalBySensitivity,
    adjustBasalByTDD,
    adjustTargetByAutosens,
    adjustTargetsForNoisyCGM,
    calculateLowGlucoseThreshold,
    adjustISFBySensitivity,
} from '../../../src/determine-basal/sensitivity-targets';
import type { Profile, AutosensData } from '../../../src/types/index';

const minProfile = {
    current_basal: 1.0,
    max_basal: 4.0,
    out_units: 'mg/dL',
} as Profile;

const autosensProfile = {
    ...minProfile,
    temptargetSet: false,
    sensitivity_raises_target: true,
    resistance_lowers_target: true,
} as unknown as Profile;

const noisyProfile = {
    ...minProfile,
    noisyCGMTargetMultiplier: 1.3,
    maxRaw: 250,
} as Profile;

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// calculateTempTargetSensitivityRatio
// ---------------------------------------------------------------------------

describe('calculateTempTargetSensitivityRatio', () => {
    it('returns 0.75 for target 120, normal 100, halfBasal 160', () => {
        // c=60, sensitivityRatio = 60/(60+120-100) = 60/80 = 0.75
        const result = calculateTempTargetSensitivityRatio(120, 100, 160, 1.2);
        expect(result).toBe(0.75);
    });

    it('returns autosens_max when c*denominator <= 0', () => {
        // halfBasalTarget=90, normalTarget=100, c=-10
        // target_bg=110: c*(c+110-100) = -10*0 = 0 <= 0
        const result = calculateTempTargetSensitivityRatio(110, 100, 90, 1.5);
        expect(result).toBe(1.5);
    });

    it('caps at autosens_max', () => {
        // target_bg=80, normalTarget=100, halfBasal=160, c=60
        // sensitivityRatio = 60/(60+80-100) = 60/40 = 1.5 -> min(1.5, 1.2) = 1.2
        const result = calculateTempTargetSensitivityRatio(80, 100, 160, 1.2);
        expect(result).toBe(1.2);
    });

    it('returns 0.5 for target 160', () => {
        // c=60, sens = 60/(60+160-100) = 60/120 = 0.5
        const result = calculateTempTargetSensitivityRatio(160, 100, 160, 1.2);
        expect(result).toBe(0.5);
    });
});

// ---------------------------------------------------------------------------
// adjustBasalBySensitivity
// ---------------------------------------------------------------------------

describe('adjustBasalBySensitivity', () => {
    // Signature: (basal, sensitivityRatio, overrideFactor, dynISFenabled, profile, profile_current_basal)
    // Adjusts only when sensitivityRatio is truthy AND dynISFenabled is false.
    // Formula: profile.current_basal * overrideFactor * sensitivityRatio -> round_basal

    it('returns adjusted basal when sensitivity changes it', () => {
        // 1.0 * 1.0 * 0.8 = 0.8, round_basal(0.8) with BASAL_SCALE_DEFAULT=20 -> 0.8
        const result = adjustBasalBySensitivity(1.0, 0.8, 1.0, false, minProfile, 1.0);
        expect(result).toBe(0.8);
    });

    it('applies override factor', () => {
        // 1.0 * 1.5 * 1.0 = 1.5, round_basal(1.5) with mid-range scale=20 -> 1.5
        const result = adjustBasalBySensitivity(1.0, 1.0, 1.5, false, minProfile, 1.5);
        expect(result).toBe(1.5);
    });

    it('does not adjust when dynISFenabled is true', () => {
        const result = adjustBasalBySensitivity(1.0, 0.8, 1.0, true, minProfile, 1.0);
        expect(result).toBe(1.0);
    });

    it('logs adjustment when basal changes', () => {
        // 1.0 * 1.0 * 1.2 = 1.2, profile_current_basal=1.0 -> different -> logs "Adjusting"
        adjustBasalBySensitivity(1.0, 1.2, 1.0, false, minProfile, 1.0);
        expect(process.stderr.write).toHaveBeenCalledWith(
            expect.stringContaining('Adjusting basal from'),
        );
    });

    it('logs unchanged when basal stays the same', () => {
        // 1.0 * 1.0 * 1.0 = 1.0, profile_current_basal=1.0 -> same -> logs "unchanged"
        adjustBasalBySensitivity(1.0, 1.0, 1.0, false, minProfile, 1.0);
        expect(process.stderr.write).toHaveBeenCalledWith(
            expect.stringContaining('Basal unchanged'),
        );
    });
});

// ---------------------------------------------------------------------------
// adjustBasalByTDD
// ---------------------------------------------------------------------------

describe('adjustBasalByTDD', () => {
    // Signature: (basal, tdd24h_14d_Ratio, overrideFactor, profile, profile_current_basal,
    //             tdd_before, weightedAverage, average_total_data, weightPercentage)
    // Formula: profile.current_basal * tdd24h_14d_Ratio * overrideFactor -> round_basal

    it('returns basal adjusted by TDD ratio and override factor', () => {
        // 1.0 * 1.1 * 1.0 = 1.1, round_basal(1.1) with mid-range scale=20 -> 1.1
        const result = adjustBasalByTDD(1.0, 1.1, 1.0, minProfile, 1.0, 50, 40, 45, 0.5);
        expect(result).toBe(1.1);
    });

    it('logs TDD adjustment details when average_total_data > 0', () => {
        adjustBasalByTDD(1.0, 1.1, 1.0, minProfile, 1.0, 50, 40, 45, 0.5);
        expect(process.stderr.write).toHaveBeenCalledWith(
            expect.stringContaining('TDD-adjustment of basals activated'),
        );
    });

    it('does not log when average_total_data is 0', () => {
        adjustBasalByTDD(1.0, 1.1, 1.0, minProfile, 1.0, 50, 40, 0, 0.5);
        expect(process.stderr.write).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// adjustTargetByAutosens
// ---------------------------------------------------------------------------

describe('adjustTargetByAutosens', () => {
    // Signature: (target_bg, min_bg, max_bg, profile, autosens_data)
    // Uses TARGET_BG_PIVOT=60, MIN_BG_TARGET=80
    // Only adjusts when !temptargetSet && autosens_data exists && (sensitivity_raises + ratio<1 || resistance_lowers + ratio>1)

    it('adjusts target upward when ratio < 1 (more sensitive)', () => {
        // adj = round((100-60)/0.8) + 60 = round(50) + 60 = 110
        const result = adjustTargetByAutosens(100, 100, 100, autosensProfile, { ratio: 0.8 } as AutosensData);
        expect(result.target_bg).toBe(110);
        expect(result.min_bg).toBe(110);
        expect(result.max_bg).toBe(110);
    });

    it('adjusts target downward when ratio > 1 (more resistant)', () => {
        // adj = round((100-60)/1.2) + 60 = round(33.33) + 60 = 93
        const result = adjustTargetByAutosens(100, 100, 100, autosensProfile, { ratio: 1.2 } as AutosensData);
        expect(result.target_bg).toBe(93);
    });

    it('does not let target_bg go below 80', () => {
        // adj = round((85-60)/2.0) + 60 = round(12.5) + 60 = 73 -> max(80, 73) = 80
        const result = adjustTargetByAutosens(85, 85, 85, autosensProfile, { ratio: 2.0 } as AutosensData);
        expect(result.target_bg).toBe(80);
    });

    it('leaves target unchanged when ratio is 1', () => {
        // ratio=1.0 -> neither < 1 nor > 1 -> no adjustment
        const result = adjustTargetByAutosens(100, 100, 100, autosensProfile, { ratio: 1.0 } as AutosensData);
        expect(result.target_bg).toBe(100);
        expect(result.min_bg).toBe(100);
        expect(result.max_bg).toBe(100);
    });

    it('skips adjustment when temptargetSet is true', () => {
        const tempProfile = { ...autosensProfile, temptargetSet: true } as unknown as Profile;
        const result = adjustTargetByAutosens(100, 100, 100, tempProfile, { ratio: 0.8 } as AutosensData);
        expect(result.target_bg).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// adjustTargetsForNoisyCGM
// ---------------------------------------------------------------------------

describe('adjustTargetsForNoisyCGM', () => {
    // Signature: (min_bg, target_bg, max_bg, noise, profile)
    // CGM_NOISE_LEVEL_NOISY=2, MAX_BG_TARGET=200
    // Only adjusts when noise >= 2

    it('raises targets by the multiplier', () => {
        // 100 * 1.3 = 130, round(min(200, 130)) = 130
        const result = adjustTargetsForNoisyCGM(100, 100, 100, 2, noisyProfile);
        expect(result.min_bg).toBe(130);
        expect(result.target_bg).toBe(130);
        expect(result.max_bg).toBe(130);
        expect(result.adjusted).toBe(true);
    });

    it('caps at MAX_BG_TARGET (200)', () => {
        // 180 * 1.3 = 234, round(min(200, 234)) = 200
        const result = adjustTargetsForNoisyCGM(180, 180, 180, 2, noisyProfile);
        expect(result.min_bg).toBe(200);
        expect(result.target_bg).toBe(200);
        expect(result.max_bg).toBe(200);
    });

    it('handles multiplier of 1.1 (minimum via MIN_NOISY_TARGET_MULTIPLIER)', () => {
        const lowMultiplierProfile = { ...minProfile, noisyCGMTargetMultiplier: 0.5, maxRaw: 250 } as Profile;
        // Math.max(1.1, 0.5) = 1.1; 100 * 1.1 = 110
        const result = adjustTargetsForNoisyCGM(100, 100, 100, 2, lowMultiplierProfile);
        expect(result.min_bg).toBe(110);
        expect(result.target_bg).toBe(110);
        expect(result.max_bg).toBe(110);
    });

    it('returns unadjusted when noise < CGM_NOISE_LEVEL_NOISY', () => {
        const result = adjustTargetsForNoisyCGM(100, 100, 100, 1, noisyProfile);
        expect(result.adjusted).toBe(false);
        expect(result.target_bg).toBe(100);
    });
});

// ---------------------------------------------------------------------------
// calculateLowGlucoseThreshold
// ---------------------------------------------------------------------------

describe('calculateLowGlucoseThreshold', () => {
    // Formula: threshold = min_bg - 0.5*(min_bg-40)
    // Return: min(max(threshold_setting, threshold, 60), 120)

    it('returns 70 for min_bg=100 (formula: 100 - 0.5*(100-40) = 70)', () => {
        const result = calculateLowGlucoseThreshold(100, 60);
        expect(result).toBe(70);
    });

    it('returns 65 for min_bg=90 (formula: 90 - 0.5*(90-40) = 65)', () => {
        const result = calculateLowGlucoseThreshold(90, 60);
        expect(result).toBe(65);
    });

    it('uses threshold_setting when higher than formula', () => {
        // formula: 100 - 0.5*(100-40) = 70, threshold_setting=75 -> max(75,70,60) = 75
        const result = calculateLowGlucoseThreshold(100, 75);
        expect(result).toBe(75);
    });

    it('caps at MAX_THRESHOLD_BG (120)', () => {
        const result = calculateLowGlucoseThreshold(100, 150);
        expect(result).toBe(120);
    });

    it('floors at MIN_THRESHOLD_BG (60)', () => {
        // formula: 50 - 0.5*(50-40) = 45, threshold_setting=30 -> max(30,45,60) = 60
        const result = calculateLowGlucoseThreshold(50, 30);
        expect(result).toBe(60);
    });
});

// ---------------------------------------------------------------------------
// adjustISFBySensitivity
// ---------------------------------------------------------------------------

describe('adjustISFBySensitivity', () => {
    // Signature: (sensitivity, sensitivityRatio, profile, autosens_data)
    // Only adjusts when autosens_data is defined and truthy

    it('divides sensitivity by ratio and rounds to 1 decimal', () => {
        // 50 / 1.2 = 41.666... -> round to 1 decimal = 41.7
        const result = adjustISFBySensitivity(50, 1.2, minProfile, { ratio: 1.2 } as AutosensData);
        expect(result.adjustedSens).toBe(41.7);
    });

    it('returns unchanged ISF when ratio is 1', () => {
        const result = adjustISFBySensitivity(50, 1.0, minProfile, { ratio: 1.0 } as AutosensData);
        expect(result.adjustedSens).toBe(50);
    });

    it('builds isfreason string with arrow notation', () => {
        const result = adjustISFBySensitivity(50, 1.2, minProfile, { ratio: 1.2 } as AutosensData);
        expect(result.isfreason).toContain('Autosens ratio: 1.2');
        expect(result.isfreason).toContain('ISF:');
        expect(result.isfreason).toContain('\u2192');
    });

    it('logs ISF change when adjustedSens differs', () => {
        adjustISFBySensitivity(50, 1.2, minProfile, { ratio: 1.2 } as AutosensData);
        expect(process.stderr.write).toHaveBeenCalledWith(
            expect.stringContaining('ISF from'),
        );
    });

    it('logs ISF unchanged when ratio is 1', () => {
        adjustISFBySensitivity(50, 1.0, minProfile, { ratio: 1.0 } as AutosensData);
        expect(process.stderr.write).toHaveBeenCalledWith(
            expect.stringContaining('ISF unchanged'),
        );
    });
});
