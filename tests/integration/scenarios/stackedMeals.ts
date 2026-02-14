/**
 * Stacked Meals scenarios — multiple carb entries, COB accumulation.
 * Real-world common: snacking, multi-course meals.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const stackedMealScenarios: IntegrationScenario[] = [
    {
        name: 'Two meals stacked — 30g at -60min and 40g at -20min',
        category: 'stacked-meals',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 170,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [
                    { minutesAgo: 60, carbs: 30 },
                    { minutesAgo: 20, carbs: 40 },
                ],
                boluses: [
                    { minutesAgo: 60, amount: 3.0 },
                    { minutesAgo: 20, amount: 4.0 },
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
                // Both carb entries should be detected
                expect(result.mealData.carbs).toBeGreaterThan(0);
            },
            (result) => {
                // IOB should reflect both boluses
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: 'Large meal (80g) with partial bolus — under-bolused, BG rising fast',
        category: 'stacked-meals',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'spiking',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 40, carbs: 80 }],
                boluses: [{ minutesAgo: 40, amount: 4.0 }], // Only half the needed bolus
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
                // Should recommend increased insulin to compensate
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThanOrEqual(0.9);
                }
            },
        ],
    },
];
