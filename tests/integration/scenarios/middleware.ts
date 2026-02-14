/**
 * Middleware scenarios — tests the middleware passthrough that Trio uses.
 *
 * In oref, the middleWare callback is passed into determineBasal() but is
 * NOT invoked inside the JS code. It's the Swift (iOS) layer that calls
 * middleWare(result) after JS returns. The JS side only reads it as a
 * string for the reason log.
 *
 * These tests verify:
 * 1. Passing a middleware function doesn't break the pipeline
 * 2. The middleware callback works correctly when invoked (as Swift would)
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';
import type { DetermineBasalResult } from '../../../src/types/index';

/** Identity middleware — passes result through unchanged */
const identityMiddleware = (result: DetermineBasalResult): DetermineBasalResult => result;

/** Middleware that caps rate at 2.0 U/hr */
const rateCappingMiddleware = (result: DetermineBasalResult): DetermineBasalResult => {
    if (result.rate !== undefined && result.rate > 2.0) {
        return { ...result, rate: 2.0 };
    }
    return result;
};

export const middlewareScenarios: IntegrationScenario[] = [
    {
        name: 'Identity middleware — result unchanged',
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
            middleWare: identityMiddleware,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Passing middleware doesn't break the pipeline
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThan(0);
                }
            },
        ],
    },

    {
        name: 'Rate-capping middleware — callback correctly modifies result',
        category: 'middleware',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 300,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            middleWare: rateCappingMiddleware,
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // JS returns the raw (uncapped) rate — middleware is invoked by Swift
                const rawRate = result.determineBasalResult.rate;
                if (rawRate !== undefined) {
                    expect(Number.isFinite(rawRate)).toBe(true);
                    expect(rawRate).toBeGreaterThan(0);

                    // Simulate Swift's middleware invocation
                    const modified = rateCappingMiddleware(result.determineBasalResult);
                    expect(modified.rate).toBeLessThanOrEqual(2.0);
                }
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
