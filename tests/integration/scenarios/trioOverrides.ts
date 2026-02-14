/**
 * Trio Override scenarios — Trio-specific custom variables that modify dosing.
 * Tests useOverride, overridePercentage, smbIsOff, smbIsScheduledOff.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const trioOverrideScenarios: IntegrationScenario[] = [
    {
        name: 'Override active — 50% basal reduction',
        category: 'trio-overrides',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 50,
                duration: 60,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'Override active — 150% basal increase with high BG',
        category: 'trio-overrides',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overridePercentage: 150,
                duration: 60,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'Override with custom target (100 mg/dL)',
        category: 'trio-overrides',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 140,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            trioCustomVariables: {
                useOverride: true,
                overrideTarget: 100,
                overridePercentage: 100,
                duration: 60,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'SMB scheduled off — should not issue SMB even with enableSMB_always',
        category: 'trio-overrides',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            trioCustomVariables: {
                smbIsScheduledOff: true,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // SMB should be suppressed by schedule
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'SMB turned off via override — should not issue SMB',
        category: 'trio-overrides',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: true,
            trioCustomVariables: {
                smbIsOff: true,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },
];
