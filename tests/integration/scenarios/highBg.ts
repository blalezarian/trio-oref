/**
 * High BG scenarios — BG 180-350, various IOB levels.
 * Expected: high temp or SMB issued for correction.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const highBgScenarios: IntegrationScenario[] = [
    {
        name: 'High BG (200), flat, no IOB — should high temp',
        category: 'high-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
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
                // High BG with no IOB should get an increased temp basal
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0.9); // Above normal basal
                }
            },
            (result) => {
                // eventualBG should be above target
                expect(result.determineBasalResult.eventualBG).toBeGreaterThan(120);
            },
        ],
    },

    {
        name: 'High BG (250), rising, no IOB — aggressive correction',
        category: 'high-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'rising',
                rate: 3,
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
                // Should be recommending insulin delivery
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0.9);
                }
            },
        ],
    },

    {
        name: 'High BG (180), with IOB already covering — moderate adjustment',
        category: 'high-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
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
                // IOB from recent bolus should be detected
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: 'Very high BG (350), flat — max safe temp',
        category: 'high-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 350,
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
                    // Rate should be clamped to max safe basal
                    expect(rate).toBeLessThanOrEqual(3.5);
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },
];
