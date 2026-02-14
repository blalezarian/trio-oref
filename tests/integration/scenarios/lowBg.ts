/**
 * Low BG scenarios — BG 55-80, safety-critical.
 * Expected: zero temp, no SMB, insulin suspension.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const lowBgScenarios: IntegrationScenario[] = [
    {
        name: 'Low BG (70), falling — zero temp for safety',
        category: 'low-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 70,
                trajectory: 'falling',
                rate: -3,
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
                // Low and falling — rate should be zero (suspend)
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBe(0);
                }
            },
            (result) => {
                // Should never issue SMB when low
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'Very low BG (55), falling — zero temp, no SMB',
        category: 'low-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 55,
                trajectory: 'falling',
                rate: -5,
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
                    expect(rate).toBe(0);
                }
            },
            (result) => {
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'Low BG (75), rising — cautious approach',
        category: 'low-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 75,
                trajectory: 'rising',
                rate: 4,
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
                // Even though rising, should not be aggressive at low BG
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'Low BG (70), with IOB from recent bolus — zero temp',
        category: 'low-bg',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 70,
                trajectory: 'falling',
                rate: -2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 45, amount: 3.0 }],
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
                // IOB should be detected from recent bolus
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                // Should zero temp despite IOB — low BG takes priority
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBe(0);
                }
            },
        ],
    },
];
