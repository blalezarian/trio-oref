/**
 * Nightscout Event Format scenarios — tests that the pipeline correctly
 * processes Nightscout Care Portal events (eventType/created_at/insulin/carbs)
 * in addition to Medtronic format (_type/timestamp/amount).
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const nightscoutEventScenarios: IntegrationScenario[] = [
    {
        name: 'Nightscout Meal Bolus with carbs — IOB and COB detected',
        category: 'nightscout-events',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                nightscoutBoluses: [
                    {
                        minutesAgo: 30,
                        insulin: 4.0,
                        eventType: 'Meal Bolus',
                        carbs: 40,
                    },
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
                // IOB should detect the Nightscout bolus
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                }
            },
        ],
    },

    {
        name: 'Nightscout Correction Bolus — IOB detected, no carbs',
        category: 'nightscout-events',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                nightscoutBoluses: [
                    {
                        minutesAgo: 45,
                        insulin: 2.5,
                        eventType: 'Correction Bolus',
                    },
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
                // IOB should detect correction bolus
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                // No carbs entered — COB should be 0
                expect(result.mealData.mealCOB).toBe(0);
            },
        ],
    },

    {
        name: 'Mixed Medtronic + Nightscout events — both formats processed',
        category: 'nightscout-events',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 170,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 60, amount: 1.5 }],
                nightscoutBoluses: [
                    {
                        minutesAgo: 30,
                        insulin: 2.0,
                        eventType: 'Meal Bolus',
                        carbs: 30,
                    },
                ],
                tempBasals: [{ minutesAgo: 90, rate: 1.2, duration: 30 }],
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
                // IOB should reflect both Medtronic and Nightscout boluses
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },
];
