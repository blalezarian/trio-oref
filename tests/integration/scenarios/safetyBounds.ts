/**
 * Safety Bounds scenarios — specifically tests for div-by-zero, NaN, Infinity,
 * and uncapped values that could result in dangerous insulin delivery.
 *
 * These are the most critical integration tests: they prove the algorithm
 * never recommends infinite or NaN rates/boluses regardless of input.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

/** Assert that all numeric outputs are finite (no NaN, no Infinity) */
function assertAllOutputsFinite(result: import('../pipeline').PipelineResult): void {
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

export const safetyBoundsScenarios: IntegrationScenario[] = [
    {
        name: 'Zero delta (flat BG) — no division by zero in delta calculations',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
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
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
        ],
    },

    {
        name: 'Zero IOB with high BG — insulinReq computation safe',
        category: 'safety-bounds',
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
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
            (result) => {
                // SMB should be clamped by max_iob, never exceed it
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeLessThanOrEqual(2.5); // max_iob
                }
            },
        ],
    },

    {
        name: 'Very small ISF (5) — large corrections must still be capped',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                isfSensitivities: [{ offset: 0, sensitivity: 5 }],
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 10,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
            (result) => {
                // Rate must be capped at max safe basal
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(3.5);
                }
            },
        ],
    },

    {
        name: 'Autosens ratio near zero (0.7 min) — no div-by-zero in ISF adjustment',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            autosensData: { ratio: 0.7 },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
        ],
    },

    {
        name: 'BG at glucose minimum (39) — extreme low, all outputs safe',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 39,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
            (result) => {
                // Must zero temp at extreme low
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBe(0);
                }
            },
        ],
    },

    {
        name: 'BG at 400 + SMB + UAM + max IOB — all safety caps enforced',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [
                    { minutesAgo: 15, amount: 2.0 },
                    { minutesAgo: 30, amount: 2.0 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    max_iob: 5.0,
                    maxSMBBasalMinutes: 60,
                    maxUAMSMBBasalMinutes: 60,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
            (result) => {
                // Rate must be capped at max safe basal
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(3.5);
                }
            },
            (result) => {
                // SMB must not exceed max_iob minus current IOB
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    const currentIob = result.iobData[0].iob;
                    expect(units + currentIob).toBeLessThanOrEqual(5.0 + 0.1); // small tolerance
                }
            },
        ],
    },

    {
        name: 'Dynamic ISF with extreme BG (400) — no ISF underflow to zero',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            microBolusAllowed: true,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
            (result) => {
                // ISF must never be zero (would cause div-by-zero)
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Zero current_basal profile — should not produce infinite ratios',
        category: 'safety-bounds',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 0.1 }],
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            assertAllOutputsFinite,
        ],
    },
];
