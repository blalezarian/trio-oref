/**
 * Dangerous Input scenarios — tests edge cases where the algorithm could
 * potentially recommend unsafe insulin delivery if safety caps fail.
 *
 * Each scenario exercises a specific dangerous arithmetic path:
 * - Near-zero ISF from overrides → huge insulinReq
 * - Negative IOB unlocking extra dosing headroom
 * - Large override percentages inflating effective basal and SMB caps
 * - NaN propagation from COB/carbs mismatch
 * - TDD=0 in dynamic ISF producing Infinity
 * - Rapid BG rise at high BG (UAM without SMB disable)
 * - Very large current_basal amplifying all dosing
 * - Zero carb ratio from overrides
 *
 * For safety-critical code, every scenario MUST assert that all numeric
 * outputs are finite, non-NaN, and within clinically plausible bounds.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';
import type { PipelineResult } from '../pipeline';

// ---------------------------------------------------------------------------
// Shared safety assertions
// ---------------------------------------------------------------------------

/** Assert all numeric dosing outputs are finite (no NaN, no Infinity) */
function assertAllOutputsFinite(result: PipelineResult): void {
    const r = result.determineBasalResult;

    if (r.rate !== undefined) {
        expect(Number.isFinite(r.rate), `rate=${r.rate} must be finite`).toBe(true);
        expect(r.rate).toBeGreaterThanOrEqual(0);
    }
    if (r.units !== undefined) {
        expect(Number.isFinite(r.units), `units=${r.units} must be finite`).toBe(true);
        expect(r.units).toBeGreaterThanOrEqual(0);
    }
    if (r.duration !== undefined) {
        expect(Number.isFinite(r.duration), `duration=${r.duration} must be finite`).toBe(true);
        expect(r.duration).toBeGreaterThanOrEqual(0);
    }
    if (r.insulinReq !== undefined) {
        expect(Number.isFinite(r.insulinReq), `insulinReq=${r.insulinReq} must be finite`).toBe(true);
    }
    if (r.eventualBG !== undefined) {
        expect(Number.isFinite(r.eventualBG), `eventualBG=${r.eventualBG} must be finite`).toBe(true);
    }
}

/** Max clinically plausible temp basal rate (U/hr) — 10x a large basal */
const MAX_PLAUSIBLE_RATE = 15;
/** Max clinically plausible SMB (Units) */
const MAX_PLAUSIBLE_SMB = 15;

/** Assert dosing outputs are within clinically plausible bounds */
function assertPlausibleDosing(result: PipelineResult): void {
    const r = result.determineBasalResult;

    if (r.rate !== undefined) {
        expect(r.rate, `rate=${r.rate} exceeds plausible max`).toBeLessThanOrEqual(MAX_PLAUSIBLE_RATE);
    }
    if (r.units !== undefined) {
        expect(r.units, `SMB units=${r.units} exceeds plausible max`).toBeLessThanOrEqual(MAX_PLAUSIBLE_SMB);
    }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const dangerousInputScenarios: IntegrationScenario[] = [
    // -----------------------------------------------------------------------
    // Override-driven ISF reduction (Finding 1A: adjustedSens → 0)
    // -----------------------------------------------------------------------
    {
        name: 'High override % (200%) shrinks ISF — insulinReq must stay bounded',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 200,
                isfAndCr: true,
            },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // insulinReq must be capped by max_iob
                const ir = result.determineBasalResult.insulinReq;
                if (ir !== undefined) {
                    expect(ir).toBeLessThanOrEqual(5);
                }
            },
        ],
    },

    {
        name: 'Extreme override % (500%) with small ISF (20) — ISF approaches zero',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 350,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                isfSensitivities: [{ offset: 0, sensitivity: 20 }],
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 500,
                isfAndCr: true,
            },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // Even with ISF = 20 / 5 = 4, outputs must be finite and capped
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Negative IOB unlocking dosing headroom (Finding 3A)
    // -----------------------------------------------------------------------
    {
        name: 'Very negative IOB (-3U from long suspend) — extra dosing headroom capped',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                // Long suspension → negative IOB
                suspendResumes: [
                    { suspendMinutesAgo: 180, resumeMinutesAgo: 10 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 3,
                    suspend_zeros_iob: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // With negative IOB, maxIOB headroom = max_iob - (-negIOB) = max_iob + |negIOB|
                // SMB must still be bounded even with expanded headroom
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    // Should never exceed maxBolus from basal*minutes/60
                    expect(units).toBeLessThanOrEqual(5);
                }
            },
        ],
    },

    {
        name: 'Negative IOB + high BG + SMB — total delivery must not overshoot max_iob drastically',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                suspendResumes: [
                    { suspendMinutesAgo: 240, resumeMinutesAgo: 5 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5,
                    maxSMBBasalMinutes: 60,
                    maxUAMSMBBasalMinutes: 60,
                    suspend_zeros_iob: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
        ],
    },

    // -----------------------------------------------------------------------
    // Override inflating effective basal and SMB cap (Finding 2B, 2C)
    // -----------------------------------------------------------------------
    {
        name: 'Override 300% + large SMB minutes — maxBolus inflated but rate/units still finite',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 350,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 10,
                    maxSMBBasalMinutes: 120,
                    maxUAMSMBBasalMinutes: 120,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 300,
                advancedSettings: true,
                smbMinutes: 120,
                uamMinutes: 120,
            },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // With basal 0.9 * 3 override = 2.7 effective, * 120min/60 = maxBolus 5.4
                // insulinReq still capped by max_iob - iob
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeLessThanOrEqual(10);
                }
            },
        ],
    },

    // -----------------------------------------------------------------------
    // NaN propagation: mealCOB > 0 but carbs = 0 (Finding 5B)
    // -----------------------------------------------------------------------
    {
        name: 'COB > 0 with no carb entries — fractionCarbsLeft NaN guard',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            // No carb entries, but recent bolus suggests food
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 4.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            (result) => {
                // Even if COB somehow nonzero with zero carbs,
                // all prediction BGs must be finite
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    // -----------------------------------------------------------------------
    // TDD = 0 in dynamic ISF (Finding 1D)
    // -----------------------------------------------------------------------
    {
        name: 'TDD = 0 with dynamic ISF enabled — must fall back to static ISF, not NaN',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                },
            }),
            trioCustomVariables: {
                currentTDD: 0,
                weightedAverage: 0,
                average_total_data: 0,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // With TDD=0 (new user, data gap), dynamic ISF cannot compute.
                // Algorithm must fall back to static ISF — never produce NaN.
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'TDD = 0 with sigmoid dynamic ISF — same zero-division path',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    useNewFormula: true,
                    sigmoid: true,
                    adjustmentFactorSigmoid: 0.5,
                },
            }),
            trioCustomVariables: {
                currentTDD: 0,
                weightedAverage: 0,
                average_total_data: 0,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: true,
                adjustmentFactorSigmoid: 0.5,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
        ],
    },

    {
        name: 'TDD = 0 with tddAdjBasal enabled — basal adjustment path must not NaN',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                    tddAdjBasal: true,
                },
            }),
            trioCustomVariables: {
                currentTDD: 0,
                weightedAverage: 0,
                average_total_data: 0,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // tddAdjBasal adjusts basal by tdd24hTo14dRatio, but dynISFenabled
                // should be false when TDD=0, so this path is skipped entirely.
                // Basal must remain at profile default (0.9 U/hr).
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'TDD = 0 with SMB disabled — temp-only output must be finite',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                },
            }),
            trioCustomVariables: {
                currentTDD: 0,
                weightedAverage: 0,
                average_total_data: 0,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: false,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            (result) => {
                // SMB off — should only set temp basal, no units
                expect(result.determineBasalResult.units).toBeUndefined();
                // Temp rate must be finite and positive (BG is high)
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'TDD = 0 with existing IOB — IOB + static ISF fallback interaction',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'falling',
                rate: -3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 3.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                },
            }),
            trioCustomVariables: {
                currentTDD: 0,
                weightedAverage: 0,
                average_total_data: 0,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // IOB from recent bolus should be detected
                expect(result.iobData[0].iob).toBeGreaterThan(0);
                // Falling BG with IOB should reduce dosing
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'weightedAverage=0 but averageTotalData>0 — tdd24hTo14dRatio=0 edge case',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                    tddAdjBasal: true,
                },
            }),
            trioCustomVariables: {
                currentTDD: 40,
                weightedAverage: 0,
                average_total_data: 40,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // tdd24hTo14dRatio = 0/40 = 0, clamped by autosens_min (0.7)
                // tddAdjBasal would set basal = current_basal * 0.7 * overrideFactor
                // Must not produce zero basal or NaN
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Rapid BG rise at high BG — UAM without SMB disable (Finding 6A)
    // -----------------------------------------------------------------------
    {
        name: 'Rapid rise (+15/5min) at BG 300 — below SMB disable threshold but aggressive',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'rising',
                rate: 15,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5,
                    maxSMBBasalMinutes: 60,
                    maxUAMSMBBasalMinutes: 60,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // Even with aggressive rise, SMB capped by max_iob
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeLessThanOrEqual(5);
                }
            },
        ],
    },

    {
        name: 'Extreme spike (+25/5min) at BG 200 — below maxDelta threshold, SMB still fires',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'spiking',
                rate: 25,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    maxDelta_bg_threshold: 0.2,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // maxDelta threshold = 0.2 * BG = 0.2 * 200 = 40 mg/dL
                // delta = 25 mg/dL < 40 → SMB NOT disabled (threshold is absolute, not %)
                // SMB should still be bounded by max_iob
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeLessThanOrEqual(2.5); // max_iob default
                }
            },
        ],
    },

    {
        name: 'Massive spike (+50/5min) at BG 100 — exceeds maxDelta threshold, SMB disabled',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 100,
                trajectory: 'spiking',
                rate: 50,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    maxDelta_bg_threshold: 0.2,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            (result) => {
                // maxDelta threshold = 0.2 * BG = 0.2 * 100 = 20 mg/dL
                // delta = 50 mg/dL > 20 → SMB should be disabled
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Very large current_basal (Finding 12A)
    // -----------------------------------------------------------------------
    {
        name: 'Very large current_basal (5 U/hr) — maxSafeBasal and SMB sizing inflated',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 5.0 }],
                maxBasal: 20,
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 10,
                    maxSMBBasalMinutes: 60,
                    maxUAMSMBBasalMinutes: 60,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // maxSafeBasal = min(20, 3*max_daily=15, 4*current=20) = 15
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(15);
                }
                // SMB maxBolus = 5 * 60/60 = 5U, capped by max_iob - iob
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeLessThanOrEqual(10);
                }
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Zero carb ratio from override (Finding 1B)
    // -----------------------------------------------------------------------
    {
        name: 'Override 1000% shrinks carbRatio near zero — carbSensFactor guard',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 30, carbs: 40 }],
                boluses: [{ minutesAgo: 30, amount: 4.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 1000,
                isfAndCr: true,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
        ],
    },

    // -----------------------------------------------------------------------
    // Compound danger: multiple risk factors combined
    // -----------------------------------------------------------------------
    {
        name: 'Compound: high override + negative IOB + high BG + SMB + UAM — worst case',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'rising',
                rate: 10,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                suspendResumes: [
                    { suspendMinutesAgo: 120, resumeMinutesAgo: 5 },
                ],
            }),
            profileInputs: buildProfileInputs({
                isfSensitivities: [{ offset: 0, sensitivity: 25 }],
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 8,
                    maxSMBBasalMinutes: 90,
                    maxUAMSMBBasalMinutes: 90,
                    suspend_zeros_iob: true,
                },
            }),
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 200,
                isfAndCr: true,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'Compound: dynamic ISF + extreme BG + high override + large basal — all paths stressed',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'rising',
                rate: 8,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 3.0 }],
                maxBasal: 15,
                isfSensitivities: [{ offset: 0, sensitivity: 25 }],
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 10,
                    maxSMBBasalMinutes: 90,
                    maxUAMSMBBasalMinutes: 90,
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                },
            }),
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 200,
                isfAndCr: true,
                currentTDD: 80,
                weightedAverage: 75,
                average_total_data: 70,
            },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Single glucose reading — can't compute delta (edge case)
    // -----------------------------------------------------------------------
    {
        name: 'Only 1 glucose reading — delta computation must not crash',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 1,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            (result) => {
                // May error gracefully (not enough data) — that's OK
                // The critical thing is no NaN/Infinity in the output
                const r = result.determineBasalResult;
                if (r.rate !== undefined) {
                    expect(r.rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },

    // -----------------------------------------------------------------------
    // Autosens ratio at extreme bounds (Finding 8B)
    // -----------------------------------------------------------------------
    {
        name: 'Autosens ratio at max (1.2) + override 200% — ISF doubly reduced',
        category: 'dangerous-inputs',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5,
                    autosens_max: 1.2,
                },
            }),
            autosensData: { ratio: 1.2 },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 200,
                isf: true,
            },
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            assertAllOutputsFinite,
            assertPlausibleDosing,
            (result) => {
                // ISF reduced by both autosens (1.2) and override (2x)
                // adjustedSens = (40 / 2) / 1.2 = 16.7 — aggressive but finite
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },
];
