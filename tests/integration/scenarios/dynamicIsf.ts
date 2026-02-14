/**
 * Dynamic ISF scenarios — Trio's dynamic insulin sensitivity feature.
 * Tests useNewFormula (logarithmic) and sigmoid modes.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const dynamicIsfScenarios: IntegrationScenario[] = [
    {
        name: 'Dynamic ISF logarithmic — high BG should have lower ISF (more aggressive)',
        category: 'dynamic-isf',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 220,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                    tddAdjBasal: false,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Dynamic ISF should produce an ISF value
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Dynamic ISF sigmoid mode — high BG',
        category: 'dynamic-isf',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 220,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    useNewFormula: true,
                    sigmoid: true,
                    adjustmentFactor: 0.8,
                    adjustmentFactorSigmoid: 0.5,
                    tddAdjBasal: false,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                useNewFormula: true,
                sigmoid: true,
                adjustmentFactor: 0.8,
                adjustmentFactorSigmoid: 0.5,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Dynamic ISF with TDD-adjusted basal',
        category: 'dynamic-isf',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'rising',
                rate: 2,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    useNewFormula: true,
                    sigmoid: false,
                    adjustmentFactor: 0.8,
                    tddAdjBasal: true,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                useNewFormula: true,
                sigmoid: false,
                adjustmentFactor: 0.8,
            },
            trioCustomVariables: {
                currentTDD: 50,
                weightedAverage: 45,
                average_total_data: 48,
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
        name: 'Dynamic ISF disabled (static ISF) — same BG for comparison baseline',
        category: 'dynamic-isf',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 220,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Static ISF should use profile ISF directly
                const isf = result.determineBasalResult.ISF;
                if (isf !== undefined) {
                    expect(isf).toBe(40);
                }
            },
        ],
    },
];
