/**
 * Golden assertion tests for determine-basal.
 *
 * These tests compare the refactored TypeScript output against immutable
 * golden outputs generated from the ORIGINAL JavaScript code.
 *
 * There is no --update flag. If a test fails, either:
 *   1. Fix the TS code to match the original JS output, OR
 *   2. Deliberately edit the golden JSON with a reviewed commit
 *
 * SAFETY: This is the ultimate proof that the refactor is correct.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { generateAllFixtures } from '../characterization/helpers/fixtures';
import {
    defaultGlucoseStatus,
    defaultCurrentTemp,
    defaultIOBData,
    defaultMealData,
    defaultProfile,
    defaultAutosensData,
    defaultTrioCustomVariables,
    defaultPreferences,
    defaultBasalProfile,
} from '../characterization/helpers/defaults';

import { determineBasal } from '../../src/determineBasal/determineBasal';
import { tempBasalFunctions } from '../../src/setTempBasal/index';
import type { TempBasalFunctions, DetermineBasalResult } from '../../src/types/index';

// ─── Load golden outputs ────────────────────────────────────────────────────
const goldenPath = resolve(__dirname, 'outputs/determine-basal.json');
const golden: Record<string, unknown> = JSON.parse(readFileSync(goldenPath, 'utf8'));

// ─── Normalize (must match generation script exactly) ───────────────────────
function normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...output };
    // Strip undefined-valued keys and empty-string reason (TS initializes reason:'', original JS may not)
    for (const key of Object.keys(normalized)) {
        if (normalized[key] === undefined) delete normalized[key];
    }
    if (normalized.reason === '') delete normalized.reason;
    if (normalized.deliverAt instanceof Date) {
        normalized.deliverAt = '[DELIVER_AT]';
    } else if (typeof normalized.deliverAt === 'string') {
        normalized.deliverAt = '[DELIVER_AT]';
    }
    for (const key of Object.keys(normalized)) {
        const val = normalized[key];
        if (typeof val === 'number' && !Number.isInteger(val)) {
            normalized[key] = Math.round(val * 10000) / 10000;
        }
        // Normalize -0 to 0
        if (typeof val === 'number' && Object.is(val, -0)) {
            normalized[key] = 0;
        }
    }
    if (normalized.predBGs && typeof normalized.predBGs === 'object') {
        const predBGs = normalized.predBGs as Record<string, number[]>;
        for (const curve of Object.keys(predBGs)) {
            if (Array.isArray(predBGs[curve])) {
                predBGs[curve] = predBGs[curve].map((v: number) => Math.round(v));
            }
        }
        normalized.predBGs = predBGs;
    }
    // Normalize system time references for undefined-currentTime error path (non-deterministic)
    if (typeof normalized.reason === 'string') {
        normalized.reason = normalized.reason.replace(
            /If current system time .+ is correct, then BG data is too old\. The last BG data was read [\d.]+m ago at .+\./,
            'If current system time [SYSTEM_TIME] is correct, then BG data is too old. The last BG data was read [AGE]m ago at [BG_TIME].'
        );
    }
    return normalized;
}

// ─── Fixture-based tests ────────────────────────────────────────────────────
const fixtures = generateAllFixtures();

const categories = new Map<string, typeof fixtures>();
for (const f of fixtures) {
    const group = categories.get(f.category) ?? [];
    group.push(f);
    categories.set(f.category, group);
}

describe('golden: determine-basal', () => {
    for (const [category, categoryFixtures] of categories) {
        describe(category, () => {
            for (const f of categoryFixtures) {
                const expected = golden[f.name];
                if (expected === undefined) {
                    it.skip(`${f.name} (no golden output)`, () => {});
                    continue;
                }

                it(f.name, () => {
                    const {
                        glucoseStatus,
                        currenttemp,
                        iobData,
                        profile,
                        autosensData,
                        mealData,
                        microBolusAllowed,
                        reservoirData,
                        currentTime,
                        pumphistory,
                        preferences,
                        basalprofile,
                        trioCustomVariables,
                        middleWare,
                    } = f.input;

                    const output = determineBasal(
                        glucoseStatus,
                        currenttemp,
                        Array.isArray(iobData) ? iobData : [iobData],
                        profile,
                        autosensData,
                        mealData,
                        tempBasalFunctions as unknown as TempBasalFunctions,
                        microBolusAllowed,
                        reservoirData,
                        currentTime,
                        pumphistory ?? [],
                        preferences,
                        basalprofile,
                        trioCustomVariables,
                        middleWare as string | undefined,
                    );

                    expect(normalizeOutput(output)).toEqual(expected);
                });
            }
        });
    }

    // ─── Error path tests ───────────────────────────────────────────────
    const FIXED_TIME = '2025-01-15T12:00:00.000Z';
    const FIXED_DATE = new Date(FIXED_TIME).getTime();

    function callDetermineBasal(overrides: {
        glucose_status?: any;
        currenttemp?: any;
        iob_data?: any;
        iob_data_raw?: boolean;
        profile?: any;
        profile_raw?: boolean;
        autosens_data?: any;
        autosens_data_raw?: boolean;
        meal_data?: any;
        microBolusAllowed?: boolean;
        reservoir_data?: number;
        currentTime?: string | null;
        currentTime_raw?: boolean;
        preferences?: any;
        trio_custom_variables?: any;
        middleWare?: any;
    }) {
        return determineBasal(
            overrides.glucose_status ?? defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
            overrides.currenttemp ?? defaultCurrentTemp(),
            overrides.iob_data_raw ? overrides.iob_data : [overrides.iob_data ?? defaultIOBData()],
            overrides.profile_raw ? overrides.profile : (overrides.profile ?? defaultProfile()),
            overrides.autosens_data_raw ? overrides.autosens_data : (overrides.autosens_data ?? defaultAutosensData()),
            overrides.meal_data ?? defaultMealData(),
            tempBasalFunctions as unknown as TempBasalFunctions,
            overrides.microBolusAllowed ?? false,
            overrides.reservoir_data ?? 100,
            overrides.currentTime_raw ? (overrides.currentTime ?? undefined) : (overrides.currentTime ?? FIXED_TIME),
            [],
            overrides.preferences ?? defaultPreferences(),
            defaultBasalProfile(),
            overrides.trio_custom_variables ?? defaultTrioCustomVariables(),
            overrides.middleWare,
        );
    }

    describe('error paths', () => {
        it('undefined profile', () => {
            const output = callDetermineBasal({ profile: undefined, profile_raw: true });
            expect(output).toEqual(golden['error: undefined profile']);
        });

        it('profile without current_basal', () => {
            const profile = defaultProfile();
            delete (profile as any).current_basal;
            const output = callDetermineBasal({ profile });
            expect(normalizeOutput(output)).toEqual(golden['error: profile without current_basal']);
        });

        it('undefined iob_data', () => {
            const output = callDetermineBasal({
                iob_data: undefined,
                iob_data_raw: true,
                glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
            });
            expect(normalizeOutput(output)).toEqual(golden['error: undefined iob_data']);
        });

        it('empty iob_data array', () => {
            const output = callDetermineBasal({
                iob_data: [] as any,
                iob_data_raw: true,
                glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
            });
            expect(normalizeOutput(output)).toEqual(golden['error: empty iob_data array']);
        });

        it('undefined autosens_data', () => {
            const output = callDetermineBasal({
                autosens_data: undefined,
                autosens_data_raw: true,
            });
            expect(normalizeOutput(output)).toEqual(golden['error: undefined autosens_data']);
        });

        it('undefined currentTime', () => {
            const output = callDetermineBasal({
                currentTime: undefined,
                currentTime_raw: true,
            });
            expect(normalizeOutput(output)).toEqual(golden['error: undefined currentTime']);
        });
    });
});
