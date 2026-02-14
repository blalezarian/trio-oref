/**
 * Sensitive/Resistant Profile scenarios — very different ISF/CR values.
 * Tests the algorithm scales correctly across patient profiles.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const sensitiveProfileScenarios: IntegrationScenario[] = [
    {
        name: 'Very insulin-sensitive patient (ISF=100, CR=20) — high BG correction',
        category: 'sensitive-profile',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 0.3 }],
                isfSensitivities: [{ offset: 0, sensitivity: 100 }],
                carbRatioSchedule: [{ offset: 0, ratio: 20 }],
                maxBasal: 1.5,
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // ISF should be 100 (from isfSensitivities via profile.generate)
                expect(result.profile.sens).toBe(100);
            },
            (result) => {
                // Correction should be smaller due to high ISF
                const insulinReq = result.determineBasalResult.insulinReq;
                if (insulinReq !== undefined) {
                    // (200 - 115) / 100 = 0.85U — much less than ISF=40 case
                    expect(insulinReq).toBeLessThan(2);
                }
            },
        ],
    },

    {
        name: 'Insulin-resistant patient (ISF=15, CR=5) — high BG correction',
        category: 'sensitive-profile',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 2.0 }],
                isfSensitivities: [{ offset: 0, sensitivity: 15 }],
                carbRatioSchedule: [{ offset: 0, ratio: 5 }],
                maxBasal: 8.0,
                profileOverrides: {
                    max_iob: 8.0,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // ISF should be 15 (from isfSensitivities via profile.generate)
                expect(result.profile.sens).toBe(15);
            },
            (result) => {
                // Correction should be larger due to low ISF
                const insulinReq = result.determineBasalResult.insulinReq;
                if (insulinReq !== undefined) {
                    // (200 - 115) / 15 = 5.67U — much more than ISF=40 case
                    expect(insulinReq).toBeGreaterThan(3);
                }
            },
        ],
    },

    {
        name: 'Child profile (low basal, high ISF) — low BG safety',
        category: 'sensitive-profile',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 70,
                trajectory: 'falling',
                rate: -2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [{ minutes: 0, rate: 0.15 }],
                isfSensitivities: [{ offset: 0, sensitivity: 200 }],
                carbRatioSchedule: [{ offset: 0, ratio: 30 }],
                maxBasal: 0.8,
                profileOverrides: {
                    current_basal: 0.15,
                    max_daily_basal: 0.25,
                    max_iob: 0.5,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Safety: low BG must zero temp even with tiny basal
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
];
