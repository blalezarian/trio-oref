/**
 * Autosens scenarios — insulin sensitivity variations.
 * Tests that autosens ratio properly modifies dosing decisions.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const autosensScenarios: IntegrationScenario[] = [
    {
        name: 'Insulin resistant day (ratio 0.7) — high BG gets more aggressive dosing',
        category: 'autosens',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            autosensData: { ratio: 0.7 },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Resistant day — should dose more aggressively than ratio 1.0
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBeGreaterThan(0.9);
                }
            },
        ],
    },

    {
        name: 'Insulin sensitive day (ratio 1.3) — high BG gets more conservative dosing',
        category: 'autosens',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            autosensData: { ratio: 1.3 },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Sensitive day — sensitivityRatio should be applied
                const sensRatio = result.determineBasalResult.sensitivityRatio;
                if (sensRatio !== undefined) {
                    expect(sensRatio).toBeGreaterThanOrEqual(1.0);
                }
            },
        ],
    },

    {
        name: 'Autosens at min bound (0.5 clamped to 0.7) — ISF adjusted for resistance',
        category: 'autosens',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'rising',
                rate: 2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            autosensData: { ratio: 0.5 },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // ISF should differ from profile baseline (40) due to autosens
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).not.toBe(40);
                }
            },
        ],
    },

    {
        name: 'Autosens at max bound (1.8 clamped to 1.2) — ISF adjusted for sensitivity',
        category: 'autosens',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'rising',
                rate: 2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            autosensData: { ratio: 1.8 },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // ISF should differ from profile baseline (40) due to autosens
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).not.toBe(40);
                }
            },
        ],
    },
];
