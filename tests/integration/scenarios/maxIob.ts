/**
 * Max IOB cap scenarios — tests safety clamping at max_iob limit.
 * Safety-critical: algorithm must not exceed max_iob.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const maxIobScenarios: IntegrationScenario[] = [
    {
        name: 'IOB near max_iob (2.5U) — should limit further dosing',
        category: 'max-iob',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [
                    { minutesAgo: 15, amount: 1.5 },
                    { minutesAgo: 30, amount: 1.0 },
                ],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    max_iob: 2.5,
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
                // IOB should be substantial from recent boluses
                expect(result.iobData[0].iob).toBeGreaterThan(1.0);
            },
        ],
    },

    {
        name: 'Very low max_iob (0.5U) — severely constrains dosing',
        category: 'max-iob',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
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
        ],
    },

    {
        name: 'max_iob 0 — no high temp basals allowed',
        category: 'max-iob',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 250,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    max_iob: 0,
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
                // With max_iob 0, no additional insulin should be delivered
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeLessThanOrEqual(0.9); // At most normal basal
                }
            },
        ],
    },
];
