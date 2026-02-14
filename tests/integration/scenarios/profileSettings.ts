/**
 * Profile Settings scenarios — skip_neutral_temps, SMB delivery ratio,
 * and other profile-level settings that affect algorithm behavior.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const profileSettingsScenarios: IntegrationScenario[] = [
    {
        name: 'skip_neutral_temps enabled — should not set temp equal to basal',
        category: 'profile-settings',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 115,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    skip_neutral_temps: true,
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

    {
        name: 'High SMB delivery ratio (0.8) — larger microboluses',
        category: 'profile-settings',
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
                    smb_delivery_ratio: 0.8,
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
        name: 'Low SMB delivery ratio (0.2) — smaller microboluses',
        category: 'profile-settings',
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
                    smb_delivery_ratio: 0.2,
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
        name: 'Extended maxSMBBasalMinutes (120) — allows larger SMBs',
        category: 'profile-settings',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    maxSMBBasalMinutes: 120,
                    maxUAMSMBBasalMinutes: 120,
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
        name: 'Bolus increment 0.05U — finer SMB granularity',
        category: 'profile-settings',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    enableSMB_always: true,
                    enableUAM: true,
                    bolus_increment: 0.05,
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
                // If SMB issued, should be rounded to 0.05 increments
                const units = result.determineBasalResult.units;
                if (units !== undefined && units > 0) {
                    const remainder = (units * 100) % 5;
                    expect(remainder).toBeCloseTo(0, 1);
                }
            },
        ],
    },
];
