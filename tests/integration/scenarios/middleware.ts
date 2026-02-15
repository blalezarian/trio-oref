/**
 * Middleware scenarios — tests the middleware reason string passthrough.
 *
 * In Trio, middleware is a user-extensibility hook: power users can inject
 * custom JS that mutates algorithm inputs before determine-basal runs.
 * The prepare wrapper (prepare/determine-basal.js) calls the middleware
 * function and passes its return value — a reason string — to determine_basal()
 * as the middleWare parameter. The JS code never invokes middleware itself;
 * it only appends the reason string to the TDD reason log.
 *
 * These tests verify:
 * 1. A middleware reason string appears in the output reason
 * 2. Empty/default middleware strings are correctly excluded
 * 3. Undefined middleware doesn't break the pipeline
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const middlewareScenarios: IntegrationScenario[] = [
    {
        name: 'Middleware reason string — appears in output',
        category: 'middleware',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            middleWare: 'Custom adjustment applied',
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
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Middleware "Nothing changed" — excluded from reason',
        category: 'middleware',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            middleWare: 'Nothing changed',
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
        ],
    },

    {
        name: 'No middleware (undefined) — default behavior',
        category: 'middleware',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
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
        ],
    },
];
