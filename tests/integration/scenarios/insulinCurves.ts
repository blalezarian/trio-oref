/**
 * Insulin Curve scenarios — bilinear, rapid-acting, ultra-rapid.
 * Different curves produce different IOB decay shapes that cascade through
 * the entire pipeline. Safety-critical: wrong curve = wrong IOB = wrong dosing.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const insulinCurveScenarios: IntegrationScenario[] = [
    // =========================================================================
    // Bilinear curve — original oref0 insulin model
    // =========================================================================
    {
        name: 'Bilinear curve — high BG with recent bolus',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 60, amount: 3.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'bilinear',
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: { curve: 'bilinear' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // IOB should be positive from recent bolus
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                // Rate must be finite and non-negative
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },

    {
        name: 'Bilinear curve — low BG safety',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 65,
                trajectory: 'falling',
                rate: -3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 2.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'bilinear',
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: { curve: 'bilinear' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Low BG must zero temp regardless of curve
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBe(0);
                }
            },
            (result) => {
                expect(result.determineBasalResult.units).toBeUndefined();
            },
        ],
    },

    // =========================================================================
    // Ultra-rapid curve — Fiasp/Lyumjev with faster onset and shorter tail
    // =========================================================================
    {
        name: 'Ultra-rapid curve — high BG with recent bolus',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 200,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 60, amount: 3.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'ultra-rapid',
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: { curve: 'ultra-rapid' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // IOB should be positive (but may differ from rapid-acting due to faster decay)
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                    expect(rate).toBeGreaterThanOrEqual(0);
                }
            },
        ],
    },

    {
        name: 'Ultra-rapid curve — low BG safety',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 65,
                trajectory: 'falling',
                rate: -3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 2.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'ultra-rapid',
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: { curve: 'ultra-rapid' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(rate).toBe(0);
                }
            },
        ],
    },

    // =========================================================================
    // Custom peak time — user-specified insulin peak
    // =========================================================================
    {
        name: 'Custom peak time (45min) — rapid onset insulin',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 2.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'rapid-acting',
                    useCustomPeakTime: true,
                    insulinPeakTime: 45,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                curve: 'rapid-acting',
                useCustomPeakTime: true,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                }
            },
        ],
    },

    {
        name: 'Custom peak time (120min) — slow onset insulin',
        category: 'insulin-curves',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                boluses: [{ minutesAgo: 30, amount: 2.0 }],
            }),
            profileInputs: buildProfileInputs({
                profileOverrides: {
                    curve: 'rapid-acting',
                    useCustomPeakTime: true,
                    insulinPeakTime: 120,
                },
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            preferences: {
                curve: 'rapid-acting',
                useCustomPeakTime: true,
            },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                expect(result.iobData[0].iob).toBeGreaterThan(0);
            },
            (result) => {
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                }
            },
        ],
    },
];
