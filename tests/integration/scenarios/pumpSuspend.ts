/**
 * Pump Suspend/Resume scenarios — tests IOB calculation with pump
 * suspension events. Safety-critical: suspend_zeros_iob changes how
 * IOB decays during suspension.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const pumpSuspendScenarios: IntegrationScenario[] = [
    {
        name: 'Recent pump suspend/resume — IOB affected by suspension gap',
        category: 'pump-suspend',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 90, amount: 2.0 }],
                suspendResumes: [
                    { suspendMinutesAgo: 60, resumeMinutesAgo: 30 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    suspend_zeros_iob: true,
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
                // Pipeline should complete with suspend events in history
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },

    {
        name: 'Suspend with suspend_zeros_iob disabled — IOB continues during suspend',
        category: 'pump-suspend',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 90, amount: 2.0 }],
                suspendResumes: [
                    { suspendMinutesAgo: 60, resumeMinutesAgo: 30 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    suspend_zeros_iob: false,
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
                // IOB should still reflect bolus (suspend doesn't zero it)
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
        ],
    },

    {
        name: 'Multiple suspend/resume cycles — complex history',
        category: 'pump-suspend',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 110,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 120, amount: 1.5 }],
                suspendResumes: [
                    { suspendMinutesAgo: 100, resumeMinutesAgo: 80 },
                    { suspendMinutesAgo: 50, resumeMinutesAgo: 30 },
                ],
                tempBasals: [
                    { minutesAgo: 70, rate: 0.5, duration: 20 },
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
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
            (result) => {
                // SMB must not be infinite or NaN
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(Number.isFinite(units)).toBe(true);
                }
            },
        ],
    },
];
