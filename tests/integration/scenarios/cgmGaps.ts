/**
 * CGM Gap scenarios — missing readings, stale data, noisy CGM.
 * Expected: graceful degradation and safe defaults.
 */

import { expect } from 'vitest';
import {
    buildGlucoseArray,
    buildPumpHistory,
    buildProfileInputs,
    FIXED_TIME,
    FIXED_DATE,
} from '../helpers/rawInputs';
import type { IntegrationScenario } from './types';

export const cgmGapScenarios: IntegrationScenario[] = [
    {
        name: 'Missing middle readings (gaps in CGM) — should still compute deltas',
        category: 'cgm-gaps',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 120,
                trajectory: 'flat',
                count: 12,
                gaps: [2, 3, 4], // Missing readings 10-20 min ago
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
                // Glucose status should still be computed from available readings
                expect(result.glucoseStatus.glucose).toBeCloseTo(120, 0);
            },
        ],
    },

    {
        name: 'Stale CGM data (last reading 15 min ago) — should handle gracefully',
        category: 'cgm-gaps',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 120,
                trajectory: 'flat',
                count: 12,
                latestDate: FIXED_DATE - 15 * 60_000, // 15 minutes old
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                // Should still produce a result (may have error/warning in reason)
                expect(result.glucoseStatus.glucose).toBeCloseTo(120, 0);
            },
        ],
    },

    {
        name: 'Noisy CGM data (noise level 4) — should apply noise safety',
        category: 'cgm-gaps',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 130,
                trajectory: 'rising',
                rate: 2,
                count: 12,
                noise: 4,
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
                // Noise level should propagate to glucose status
                expect(result.glucoseStatus.noise).toBe(4);
            },
        ],
    },

    {
        name: 'Minimal glucose data (3 readings only) — should compute with limited data',
        category: 'cgm-gaps',
        inputs: {
            glucoseData: buildGlucoseArray({
                startBg: 100,
                trajectory: 'flat',
                count: 3,
            }),
            pumpHistory: buildPumpHistory({}),
            profileInputs: buildProfileInputs(),
            currentTemp: { duration: 0, rate: 0, temp: 'absolute' },
            clock: FIXED_TIME,
        },
        assertions: [
            (result) => {
                expect(result.glucoseStatus.glucose).toBeCloseTo(100, 0);
            },
        ],
    },
];
