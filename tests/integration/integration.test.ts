/**
 * Integration test runner — exercises the full Trio pipeline end-to-end.
 *
 * Each scenario calls the complete module chain:
 *   raw glucose → glucoseGetLast → glucoseStatus
 *   raw pump_history → iob.generate → iobData[]
 *   raw history/carbs → meal.generate → mealData
 *   pump_settings → profile.generate → profile
 *   → determineBasal → dosing decision
 *
 * Dual assertion strategy:
 * 1. Clinical assertions — explicit, human-readable checks on the result
 * 2. Snapshot regression — catches any unexpected output change
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { allScenarios } from './scenarios/index';
import { runFullPipeline, normalizeOutput } from './pipeline';

// Group scenarios by category for organized output
const categories = new Map<string, typeof allScenarios>();
for (const scenario of allScenarios) {
    const group = categories.get(scenario.category) ?? [];
    group.push(scenario);
    categories.set(scenario.category, group);
}

describe('Integration Pipeline', () => {
    // Pin timezone and clock so schedule lookups (basal, ISF, targets, CR)
    // resolve deterministically regardless of where/when the test runs.
    // All scenarios use FIXED_TIME = '2025-01-15T12:00:00.000Z' (noon UTC).
    const originalTZ = process.env.TZ;
    beforeAll(() => {
        process.env.TZ = 'UTC';
        vi.useFakeTimers({ now: new Date('2025-01-15T12:00:00.000Z') });
    });
    afterAll(() => {
        vi.useRealTimers();
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    });
    for (const [category, categoryScenarios] of categories) {
        describe(category, () => {
            for (const scenario of categoryScenarios) {
                it(scenario.name, () => {
                    const result = runFullPipeline(scenario.inputs);

                    // Clinical assertions (explicit, readable)
                    for (const assertion of scenario.assertions) {
                        assertion(result);
                    }

                    // Snapshot regression (catches unexpected changes)
                    expect(
                        normalizeOutput(result.determineBasalResult as unknown as Record<string, unknown>),
                    ).toMatchSnapshot();
                });
            }
        });
    }
});
