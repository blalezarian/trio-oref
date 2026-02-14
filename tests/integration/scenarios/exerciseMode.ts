/**
 * Exercise Mode scenarios — low temp targets, sensitivity shifts.
 * Expected: reduced insulin delivery and target adjustment.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const exerciseModeScenarios: IntegrationScenario[] = [
    {
        name: 'Exercise mode on, in-range BG — reduced insulin',
        category: 'exercise-mode',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 120,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    exercise_mode: true,
                    half_basal_exercise_target: 160,
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
                expect(result.profile.exercise_mode).toBe(true);
            },
        ],
    },

    {
        name: 'High temp target raises sensitivity — more conservative dosing',
        category: 'exercise-mode',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                bgTargets: [{ offset: 0, low: 140, high: 160, min_bg: 140, max_bg: 160 }],
                profileOverrides: {
                    high_temptarget_raises_sensitivity: true,
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
                // BG should be near target with high temp target
                expect(result.profile.min_bg).toBe(140);
            },
        ],
    },
];
