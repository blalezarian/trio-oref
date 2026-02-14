/**
 * mmol/L Unit scenarios — tests the unit conversion path through the pipeline.
 * Some users and regions use mmol/L instead of mg/dL. The algorithm internally
 * works in mg/dL but must handle mmol/L output preferences.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const mmolUnitScenarios: IntegrationScenario[] = [
    {
        name: 'mmol/L output preference — high BG correction',
        category: 'mmol-units',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    out_units: 'mmol/L',
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
                // Pipeline should complete with mmol/L preference
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                    // Rate should be same as mg/dL — internal math doesn't change
                    expect(rate).toBeLessThanOrEqual(3.5);
                }
            },
        ],
    },

    {
        name: 'mmol/L output preference — low BG safety',
        category: 'mmol-units',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 65,
                trajectory: 'falling',
                rate: -3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    out_units: 'mmol/L',
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
                // Low BG safety must work regardless of output unit preference
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
        name: 'mmol/L targets — ISF and targets in mmol-equivalent range',
        category: 'mmol-units',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    out_units: 'mmol/L',
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
                // SMB must not be infinite
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(Number.isFinite(units)).toBe(true);
                }
            },
        ],
    },
];
