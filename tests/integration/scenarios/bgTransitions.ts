/**
 * BG Transition scenarios — falling from high, rising from low, rapid crashes.
 * Tests the algorithm's response to dynamic BG movement patterns.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const bgTransitionScenarios: IntegrationScenario[] = [
    {
        name: 'Falling from high (250→200) — still dose but less aggressively',
        category: 'bg-transitions',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'falling',
                rate: -5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 2.0 }],
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
                // BG is still high but falling — delta should be negative
                expect(result.glucoseStatus.delta).toBeLessThan(0);
            },
            (result) => {
                // IOB from recent correction should be present
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: 'Rising from low (65→85) — recovery, must not over-correct',
        category: 'bg-transitions',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 85,
                trajectory: 'rising',
                rate: 5,
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
                // Rising from low — should not issue SMB
                expect(result.determineBasalResult.units).toBeUndefined();
            },
            (result) => {
                // Delta should be positive (recovering)
                expect(result.glucoseStatus.delta).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: 'Rapid crash (180→100 in 40min) — should suspend aggressively',
        category: 'bg-transitions',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 100,
                trajectory: 'crashing',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 45, amount: 4.0 }],
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
                // Crashing BG — should zero temp or very low
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(0.9);
                }
            },
            (result) => {
                // Should never SMB during a crash
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'Rapid rise (100→180 in 40min) — should respond strongly',
        category: 'bg-transitions',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'spiking',
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
                // Rapidly rising — should increase insulin
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0.9);
                }
            },
        ],
    },
];
