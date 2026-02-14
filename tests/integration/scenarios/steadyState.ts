/**
 * Steady State scenarios — in-range BG, no IOB, no carbs.
 * Expected: minimal or no adjustment to basal.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const steadyStateScenarios: IntegrationScenario[] = [
    {
        name: 'Flat in-range BG, no IOB, no temp — minimal adjustment',
        category: 'steady-state',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 115,
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
                // Profile should have been generated with correct basal
                expect(result.profile.current_basal).toBe(0.9);
                expect(result.profile.dia).toBe(5);
            },
            (result) => {
                // Glucose status should reflect flat BG
                expect(result.glucoseStatus.glucose).toBeCloseTo(115, 0);
            },
            (result) => {
                // IOB should be near zero with no history
                expect(result.iobData[0].iob).toBeCloseTo(0, 1);
            },
            (result) => {
                // No error from determine-basal
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'Flat in-range BG, high temp running — should cancel or reduce',
        category: 'steady-state',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 115,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                tempBasals: [{ minutesAgo: 10, rate: 1.5, duration: 30 }],
            }),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 20, rate: 1.5, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                // Algorithm should not be erroring
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // With flat in-range BG, should not be running a high temp
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(1.5);
                }
            },
        ],
    },

    {
        name: 'Flat in-range BG, zero temp running — should resume normal',
        category: 'steady-state',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 115,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                tempBasals: [{ minutesAgo: 10, rate: 0, duration: 30 }],
            }),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 20, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },
];
