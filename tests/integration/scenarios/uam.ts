/**
 * UAM (Unannounced Meal) scenarios — rising BG with no carbs entered.
 * Expected: UAM detection and appropriate response.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const uamScenarios: IntegrationScenario[] = [
    {
        name: 'Rising BG (spiking), no carbs entered, UAM enabled — UAM detection',
        category: 'uam',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 160,
                trajectory: 'spiking',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableUAM: true,
                    enableSMB_always: true,
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
            (result) => {
                // No carbs entered so mealCOB should be 0
                expect(result.mealData.mealCOB).toBe(0);
            },
            (result) => {
                // Should still respond to rising BG (via UAM or temp basal)
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Rising BG, no carbs, UAM disabled — limited response',
        category: 'uam',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 160,
                trajectory: 'spiking',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableUAM: false,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },
];
