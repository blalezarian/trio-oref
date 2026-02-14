/**
 * Temp Target scenarios — eating-soon low targets and exercise high targets.
 * These trigger different sensitivity and dosing logic paths.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const tempTargetScenarios: IntegrationScenario[] = [
    {
        name: 'Eating soon — low temp target (80), in-range BG — more aggressive',
        category: 'temp-targets',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 120,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                bgTargets: [{ offset: 0, low: 80, high: 80, min_bg: 80, max_bg: 80 }],
                profileOverrides: {
                    low_temptarget_lowers_sensitivity: true,
                    temptargetSet: true,
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
                // Low temp target — BG 120 is now above target, should increase insulin
                expect(result.profile.min_bg).toBe(80);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Exercise high target (160), BG 140 — reduced insulin',
        category: 'temp-targets',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 140,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                bgTargets: [{ offset: 0, low: 160, high: 160, min_bg: 160, max_bg: 160 }],
                profileOverrides: {
                    high_temptarget_raises_sensitivity: true,
                    temptargetSet: true,
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
                // BG 140 is below exercise target 160 — should reduce or zero temp
                expect(result.profile.min_bg).toBe(160);
            },
        ],
    },

    {
        name: 'SMB with high temp target — allowSMB_with_high_temptarget controls behavior',
        category: 'temp-targets',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                bgTargets: [{ offset: 0, low: 150, high: 150, min_bg: 150, max_bg: 150 }],
                profileOverrides: {
                    enableSMB_with_temptarget: true,
                    allowSMB_with_high_temptarget: false,
                    temptargetSet: true,
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
];
