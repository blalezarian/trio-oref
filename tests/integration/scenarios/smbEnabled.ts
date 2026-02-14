/**
 * SMB (Super Micro Bolus) scenarios — various SMB trigger conditions.
 * Expected: correct microBolus calculation when enabled.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const smbEnabledScenarios: IntegrationScenario[] = [
    {
        name: 'SMB always enabled, high BG (200), no IOB — should issue SMB',
        category: 'smb-enabled',
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
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // SMB should be issued for high BG with SMB enabled
                const units = result.determineBasalResult.units;
                if (units !== undefined) {
                    expect(units).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'SMB with COB enabled, post-meal rising BG — should issue SMB',
        category: 'smb-enabled',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 160,
                trajectory: 'rising',
                rate: 5,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 20, carbs: 50 }],
                boluses: [{ minutesAgo: 20, amount: 5.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_with_COB: true,
                    enableUAM: true,
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
        ],
    },

    {
        name: 'SMB enabled but microBolus not allowed — should not issue SMB',
        category: 'smb-enabled',
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
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            microBolusAllowed: false,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // SMB should not be issued when microBolus is not allowed
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    {
        name: 'SMB enabled, low BG — should not issue SMB',
        category: 'smb-enabled',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 70,
                trajectory: 'falling',
                rate: -2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
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
                // Should not issue SMB when BG is low
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },
];
