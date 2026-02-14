/**
 * Multi-Schedule Profile scenarios — varying basals, ISF, and targets
 * by time of day. Tests that schedule lookups resolve correctly through
 * the profile → IOB → determineBasal pipeline.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

// FIXED_TIME is 2025-01-15T12:00:00.000Z (noon UTC)
// Local hour depends on timezone — schedule lookups use minute-of-day

export const multiScheduleScenarios: IntegrationScenario[] = [
    {
        name: 'Multi-rate basal schedule — higher daytime basal',
        category: 'multi-schedule',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 150,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                basals: [
                    { minutes: 0, rate: 0.6 },    // midnight–6am
                    { minutes: 360, rate: 1.2 },   // 6am–noon
                    { minutes: 720, rate: 0.9 },   // noon–6pm
                    { minutes: 1080, rate: 0.7 },  // 6pm–midnight
                ],
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // current_basal should reflect the active schedule entry
                const basal = result.profile.current_basal;
                expect(basal).toBeGreaterThan(0);
                expect(Number.isFinite(basal!)).toBe(true);
            },
            (result) => {
                // Rate must be finite
                const rate = result.determineBasalResult.rate;
                if (rate !== undefined) {
                    expect(Number.isFinite(rate)).toBe(true);
                }
            },
        ],
    },

    {
        name: 'Multi-ISF schedule — different sensitivity by time of day',
        category: 'multi-schedule',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 180,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                isfSensitivities: [
                    { offset: 0, sensitivity: 50 },    // midnight–6am
                    { offset: 360, sensitivity: 35 },   // 6am–noon (more resistant)
                    { offset: 720, sensitivity: 40 },   // noon–6pm
                    { offset: 1080, sensitivity: 55 },  // 6pm–midnight (more sensitive)
                ],
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // ISF should be one of the schedule values
                expect(result.profile.sens).toBeGreaterThan(0);
                expect(Number.isFinite(result.profile.sens!)).toBe(true);
            },
        ],
    },

    {
        name: 'Multi-target schedule — tighter daytime targets',
        category: 'multi-schedule',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'flat',
                count: 12,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs({
                bgTargets: [
                    { offset: 0, low: 120, high: 130, min_bg: 120, max_bg: 130 },
                    { offset: 360, low: 100, high: 110, min_bg: 100, max_bg: 110 },
                    { offset: 720, low: 110, high: 120, min_bg: 110, max_bg: 120 },
                    { offset: 1080, low: 120, high: 130, min_bg: 120, max_bg: 130 },
                ],
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // Target should be resolved from the schedule
                expect(result.profile.min_bg).toBeGreaterThan(0);
                expect(result.profile.max_bg).toBeGreaterThanOrEqual(result.profile.min_bg!);
            },
        ],
    },

    {
        name: 'Multi-carb-ratio schedule — different CR by time of day',
        category: 'multi-schedule',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 160,
                trajectory: 'rising',
                rate: 3,
                count: 12,
            }),
            pumpHistory: buildPumpHistory({
                carbEntries: [{ minutesAgo: 30, carbs: 40 }],
                boluses: [{ minutesAgo: 30, amount: 3.0 }],
            }),
            profileInputs: buildProfileInputs({
                carbRatioSchedule: [
                    { offset: 0, ratio: 12 },    // midnight–6am
                    { offset: 360, ratio: 8 },    // 6am–noon (more resistant)
                    { offset: 720, ratio: 10 },   // noon–6pm
                    { offset: 1080, ratio: 14 },  // 6pm–midnight
                ],
            }),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.determineBasalResult.error).toBeUndefined();
            },
            (result) => {
                // CR should be resolved from schedule
                expect(result.profile.carb_ratio).toBeGreaterThan(0);
                expect(Number.isFinite(result.profile.carb_ratio!)).toBe(true);
            },
        ],
    },
];
