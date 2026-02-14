/**
 * Edge Case scenarios — boundary values, unusual inputs.
 * Expected: no crash, safe fallback behavior.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const edgeCaseScenarios: IntegrationScenario[] = [
    {
        name: 'BG exactly at min_bg target (110) — minimal adjustment',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 110,
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
        ],
    },

    {
        name: 'BG exactly at max_bg target (120) — minimal adjustment',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 120,
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
        ],
    },

    {
        name: 'Very high BG (400) — max safe basal clamping',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 400,
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
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    // Should be clamped to max safe basal
                    expect(rate).toBeLessThanOrEqual(3.5);
                }
            },
        ],
    },

    {
        name: 'Empty pump history — no IOB, no meals',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: [],
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                expect(result.iobData[0].iob).toBeCloseTo(0, 1);
            },
            (result) => {
                expect(result.mealData.mealCOB).toBe(0);
            },
        ],
    },

    {
        name: 'Low reservoir (5 Units) — should still compute',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            reservoirData: 5,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'Multiple recent boluses — IOB accumulation',
        category: 'edge-cases',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'falling',
                rate: -2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [
                    { minutesAgo: 15, amount: 1.0 },
                    { minutesAgo: 30, amount: 1.5 },
                    { minutesAgo: 60, amount: 2.0 },
                ],
            }),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // IOB should reflect accumulated boluses
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
        ],
    },
];
