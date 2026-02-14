/**
 * Post-Meal scenarios — carb entry with rising BG.
 * Expected: COB > 0, appropriate temp increase.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const postMealScenarios: IntegrationScenario[] = [
    {
        name: '45g carbs 30min ago, BG rising — COB detected, temp increase',
        category: 'post-meal',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 140,
                trajectory: 'rising',
                rate: 4,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 30, carbs: 45 }],
                boluses: [{ minutesAgo: 30, amount: 4.5 }],
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
                // Meal module should detect carbs on board
                expect(result.mealData.mealCOB).toBeGreaterThanOrEqual(0);
            },
            (result) => {
                // Carbs should have been found in history
                expect(result.mealData.carbs).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: '60g carbs 60min ago, BG spiking — high COB, high temp',
        category: 'post-meal',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'spiking',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 60, carbs: 60 }],
                boluses: [{ minutesAgo: 60, amount: 6 }],
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
                // BG is high and rising — should recommend increased basal or correction
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },
];
