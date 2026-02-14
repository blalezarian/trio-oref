/**
 * Golden Output Generation Script
 *
 * Runs the ORIGINAL JavaScript modules (from tmp/original-lib/lib/) with
 * the same fixture inputs used by characterization tests, and writes the
 * outputs to tests/golden/outputs/*.json as immutable reference files.
 *
 * These golden outputs can NEVER be regenerated with --update.
 * Any change requires a deliberate, reviewed edit to the JSON file.
 *
 * Usage: npx tsx scripts/generate-golden-outputs.ts
 */

import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

// createRequire lets us load CJS modules from ESM context
const cjsRequire = createRequire(import.meta.url);
const LIB = path.resolve('tmp/original-lib/lib');

// ─── Load original JS modules ───────────────────────────────────────────────
const determineBasalJS = cjsRequire(path.join(LIB, 'determine-basal/determine-basal.js'));
const basalSetTempJS = cjsRequire(path.join(LIB, 'basal-set-temp.js'));
const iobIndexJS = cjsRequire(path.join(LIB, 'iob/index.js'));
const iobTotalJS = cjsRequire(path.join(LIB, 'iob/total.js'));
const iobCalcJS = cjsRequire(path.join(LIB, 'iob/calculate.js'));
const iobHistoryJS = cjsRequire(path.join(LIB, 'iob/history.js'));
const mealIndexJS = cjsRequire(path.join(LIB, 'meal/index.js'));
const mealTotalJS = cjsRequire(path.join(LIB, 'meal/total.js'));
const mealHistoryJS = cjsRequire(path.join(LIB, 'meal/history.js'));
const cobJS = cjsRequire(path.join(LIB, 'determine-basal/cob.js'));
const autosensJS = cjsRequire(path.join(LIB, 'determine-basal/autosens.js'));
const profileIndexJS = cjsRequire(path.join(LIB, 'profile/index.js'));
const isfJS = cjsRequire(path.join(LIB, 'profile/isf.js'));
const targetsJS = cjsRequire(path.join(LIB, 'profile/targets.js'));
const carbsJS = cjsRequire(path.join(LIB, 'profile/carbs.js'));
const glucoseJS = cjsRequire(path.join(LIB, 'glucose-get-last.js'));
const autotuneJS = cjsRequire(path.join(LIB, 'autotune/index.js'));
const autotunePrepJS = cjsRequire(path.join(LIB, 'autotune-prep/index.js'));

// ─── Import TS fixture helpers ──────────────────────────────────────────────
import { generateAllFixtures } from '../tests/characterization/helpers/fixtures';
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
} from '../tests/characterization/helpers/defaults';

// ─── Output directory ───────────────────────────────────────────────────────
const OUTPUT_DIR = path.resolve('tests/golden/outputs');
mkdirSync(OUTPUT_DIR, { recursive: true });

// ─── Shared constants ───────────────────────────────────────────────────────
const FIXED_TIME = '2025-01-15T12:00:00.000Z';
const NOW = new Date(FIXED_TIME).getTime();
const BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 1, minutes: 0 }];

function ts(minsAgo: number): string {
    return new Date(NOW - minsAgo * 60_000).toISOString();
}

// ─── Normalize helpers (match characterization tests exactly) ───────────────

function normalizeDetermineBasal(output: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...output };
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
    // Strip ", Middleware: undefined" from reason — original JS bug that stringifies undefined
    if (typeof normalized.reason === 'string') {
        normalized.reason = normalized.reason.replace(', Middleware: undefined', '');
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

function normalizeIobArray(arr: object[]) {
    return arr.map((entry, i) => {
        const rec = entry as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(rec)) {
            if (key === 'time') {
                out[key] = `[TIME+${i * 5}m]`;
            } else if (key === 'iobWithZeroTemp') {
                const zt = rec[key] as Record<string, unknown>;
                out[key] = {
                    ...zt,
                    time: `[TIME+${i * 5}m]`,
                };
            } else if (key === 'lastTemp') {
                const lt = rec[key] as Record<string, unknown>;
                out[key] = (lt as { date: number }).date === 0
                    ? { date: 0 }
                    : { ...lt, started_at: '[STARTED_AT]' };
            } else {
                out[key] = rec[key];
            }
        }
        return out;
    });
}

function normalizeIobTotal(result: Record<string, unknown>) {
    const out = { ...result };
    out.time = '[TIME]';
    return out;
}

function normalizeIobHistory(results: any[]) {
    return results.map((item: any) => {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(item)) {
            if (key === 'date') {
                out[key] = `[NOW${item[key] >= NOW ? '+' : ''}${Math.round((item[key] - NOW) / 60000)}m]`;
            } else if (key === 'started_at' || key === 'created_at') {
                if (item[key] instanceof Date) {
                    const diff = Math.round((item[key].getTime() - NOW) / 60000);
                    out[key] = `[NOW${diff >= 0 ? '+' : ''}${diff}m]`;
                } else {
                    out[key] = item[key];
                }
            } else {
                out[key] = item[key];
            }
        }
        return out;
    });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Custom JSON replacer that preserves NaN as "[NaN]" instead of null.
 * JSON.stringify normally converts NaN to null, losing the distinction.
 */
function nanSafeReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'number' && isNaN(value)) return '[NaN]';
    return value;
}

function writeGolden(name: string, data: Record<string, unknown>) {
    const filePath = path.join(OUTPUT_DIR, `${name}.json`);
    writeFileSync(filePath, JSON.stringify(data, nanSafeReplacer, 2) + '\n');
    const count = Object.keys(data).length;
    console.log(`  ✓ ${name}.json (${count} fixtures)`);
}

// ─── Suppress console.error from original JS modules ────────────────────────
const origConsoleError = console.error;
const origConsoleLog = console.log;

function suppressConsole() {
    console.error = () => {};
    console.log = () => {};
}

function restoreConsole() {
    console.error = origConsoleError;
    console.log = origConsoleLog;
}

// =============================================================================
// MODULE: determine-basal
// =============================================================================
function generateDetermineBasal() {
    console.log('\nGenerating: determine-basal');
    const fixtures = generateAllFixtures();
    const golden: Record<string, unknown> = {};

    for (const f of fixtures) {
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

        suppressConsole();
        try {
            const output = determineBasalJS(
                glucoseStatus,
                currenttemp,
                Array.isArray(iobData) ? iobData : [iobData],
                profile,
                autosensData,
                mealData,
                basalSetTempJS,
                microBolusAllowed,
                reservoirData,
                currentTime,
                pumphistory ?? [],
                preferences,
                basalprofile,
                trioCustomVariables,
                middleWare,
            );
            golden[f.name] = normalizeDetermineBasal(output);
        } catch (e: any) {
            golden[f.name] = { _error: e.message };
        }
        restoreConsole();
    }

    // Error path tests (from characterization test lines 179+)
    const FIXED_DATE = new Date(FIXED_TIME).getTime();

    function callDetermineBasalJS(overrides: any) {
        suppressConsole();
        try {
            return determineBasalJS(
                overrides.glucose_status ?? defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
                overrides.currenttemp ?? defaultCurrentTemp(),
                overrides.iob_data_raw ? overrides.iob_data : [overrides.iob_data ?? defaultIOBData()],
                overrides.profile_raw ? overrides.profile : (overrides.profile ?? defaultProfile()),
                overrides.autosens_data_raw ? overrides.autosens_data : (overrides.autosens_data ?? defaultAutosensData()),
                overrides.meal_data ?? defaultMealData(),
                basalSetTempJS,
                overrides.microBolusAllowed ?? false,
                overrides.reservoir_data ?? 100,
                overrides.currentTime_raw ? (overrides.currentTime ?? undefined) : (overrides.currentTime ?? FIXED_TIME),
                [],
                overrides.preferences ?? defaultPreferences(),
                defaultBasalProfile(),
                overrides.trio_custom_variables ?? defaultTrioCustomVariables(),
                overrides.middleWare,
            );
        } catch (e: any) {
            return { _error: e.message };
        } finally {
            restoreConsole();
        }
    }

    // Error path: undefined profile
    golden['error: undefined profile'] = callDetermineBasalJS({ profile: undefined, profile_raw: true });

    // Error path: profile without current_basal
    const profileNoCB = defaultProfile();
    delete (profileNoCB as any).current_basal;
    golden['error: profile without current_basal'] = normalizeDetermineBasal(
        callDetermineBasalJS({ profile: profileNoCB }),
    );

    // Error path: undefined iob_data
    golden['error: undefined iob_data'] = normalizeDetermineBasal(
        callDetermineBasalJS({
            iob_data: undefined,
            iob_data_raw: true,
            glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
        }),
    );

    // Error path: empty iob_data array
    golden['error: empty iob_data array'] = normalizeDetermineBasal(
        callDetermineBasalJS({
            iob_data: [],
            iob_data_raw: true,
            glucose_status: defaultGlucoseStatus({ date: FIXED_DATE - 60_000 }),
        }),
    );

    // Error path: undefined autosens_data
    golden['error: undefined autosens_data'] = normalizeDetermineBasal(
        callDetermineBasalJS({
            autosens_data: undefined,
            autosens_data_raw: true,
        }),
    );

    // Error path: undefined currentTime
    golden['error: undefined currentTime'] = normalizeDetermineBasal(
        callDetermineBasalJS({
            currentTime: undefined,
            currentTime_raw: true,
        }),
    );

    writeGolden('determine-basal', golden);
}

// =============================================================================
// MODULE: basal-set-temp
// =============================================================================
function generateBasalSetTemp() {
    console.log('\nGenerating: basal-set-temp');
    const golden: Record<string, unknown> = {};

    function makeProfile(overrides: Record<string, unknown> = {}) {
        return {
            current_basal: 0.9,
            max_daily_basal: 1.3,
            max_basal: 3.5,
            max_daily_safety_multiplier: 3,
            current_basal_safety_multiplier: 4,
            skip_neutral_temps: false,
            ...overrides,
        };
    }

    // getMaxSafeBasal tests
    golden['getMaxSafeBasal: standard profile'] = basalSetTempJS.getMaxSafeBasal(makeProfile());
    golden['getMaxSafeBasal: max_basal limiting'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ max_basal: 2.0 }));
    golden['getMaxSafeBasal: daily multiplier limiting'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ max_daily_safety_multiplier: 1.5 }));
    golden['getMaxSafeBasal: current basal multiplier limiting'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ current_basal_safety_multiplier: 2 }));
    golden['getMaxSafeBasal: NaN daily multiplier defaults to 3'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ max_daily_safety_multiplier: NaN }));
    golden['getMaxSafeBasal: null daily multiplier defaults to 3'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ max_daily_safety_multiplier: null }));
    golden['getMaxSafeBasal: NaN current basal multiplier defaults to 4'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ current_basal_safety_multiplier: NaN }));
    golden['getMaxSafeBasal: null current basal multiplier defaults to 4'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ current_basal_safety_multiplier: null }));
    golden['getMaxSafeBasal: very high basal (5 U/hr)'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ current_basal: 5, max_daily_basal: 6 }));
    golden['getMaxSafeBasal: very low basal (0.1 U/hr)'] = basalSetTempJS.getMaxSafeBasal(makeProfile({ current_basal: 0.1, max_daily_basal: 0.2 }));

    // setTempBasal tests
    const profile = makeProfile();
    const rT = { duration: 0, rate: 0, reason: '' };

    golden['setTempBasal: high temp no temp running'] = basalSetTempJS.setTempBasal(2.0, 30, profile, { ...rT }, { duration: 0, rate: 0 });
    golden['setTempBasal: zero temp'] = basalSetTempJS.setTempBasal(0, 30, profile, { ...rT }, { duration: 0, rate: 0 });
    golden['setTempBasal: negative rate clamped to zero'] = basalSetTempJS.setTempBasal(-0.5, 30, profile, { ...rT }, { duration: 0, rate: 0 });
    golden['setTempBasal: high rate clamped to maxSafeBasal'] = basalSetTempJS.setTempBasal(10, 30, profile, { ...rT }, { duration: 0, rate: 0 });
    golden['setTempBasal: similar temp already running'] = basalSetTempJS.setTempBasal(1.5, 30, profile, { ...rT }, { duration: 25, rate: 1.5 });
    golden['setTempBasal: neutral temp skip_neutral_temps=false'] = basalSetTempJS.setTempBasal(0.9, 30, makeProfile({ skip_neutral_temps: false }), { ...rT }, { duration: 0, rate: 0 });
    golden['setTempBasal: neutral temp skip_neutral_temps=true'] = basalSetTempJS.setTempBasal(0.9, 30, makeProfile({ skip_neutral_temps: true }), { ...rT }, { duration: 0, rate: 0 });

    writeGolden('basal-set-temp', golden);
}

// =============================================================================
// MODULE: glucose-get-last
// =============================================================================
function generateGlucoseGetLast() {
    console.log('\nGenerating: glucose-get-last');
    const golden: Record<string, unknown> = {};
    const BASE_TIME = new Date('2025-01-15T12:00:00.000Z').getTime();

    function makeEntries(values: number[], options?: { device?: string; noise?: number }) {
        const device = options?.device ?? 'fakecgm';
        const noise = options?.noise ?? 1;
        return values.map((glucose, i) => ({
            glucose,
            date: BASE_TIME - i * 5 * 60_000,
            display_time: new Date(BASE_TIME - i * 5 * 60_000).toISOString(),
            device,
            noise,
        }));
    }

    golden['steady BG at 120'] = glucoseJS(makeEntries([120, 120, 120, 120, 120, 120]));
    golden['steady BG at 180'] = glucoseJS(makeEntries([180, 180, 180, 180, 180, 180]));
    golden['rising +2/5m'] = glucoseJS(makeEntries([130, 128, 126, 124, 122, 120]));
    golden['rising +5/5m'] = glucoseJS(makeEntries([145, 140, 135, 130, 125, 120]));
    golden['rising +10/5m'] = glucoseJS(makeEntries([170, 160, 150, 140, 130, 120]));
    golden['falling -2/5m'] = glucoseJS(makeEntries([110, 112, 114, 116, 118, 120]));
    golden['falling -5/5m'] = glucoseJS(makeEntries([95, 100, 105, 110, 115, 120]));
    golden['falling -10/5m'] = glucoseJS(makeEntries([70, 80, 90, 100, 110, 120]));
    golden['mixed: recent rise long-term fall'] = glucoseJS(makeEntries([125, 120, 130, 135, 140, 145]));
    golden['mixed: recent fall long-term rise'] = glucoseJS(makeEntries([115, 120, 110, 105, 100, 95]));
    golden['single entry'] = glucoseJS(makeEntries([120]));
    golden['two entries'] = glucoseJS(makeEntries([125, 120]));
    golden['three entries'] = glucoseJS(makeEntries([130, 125, 120]));
    golden['low BG'] = glucoseJS(makeEntries([55, 55, 55, 55, 55, 55]));
    golden['high BG'] = glucoseJS(makeEntries([350, 350, 350, 350, 350, 350]));
    golden['noise level 3'] = glucoseJS(makeEntries([120, 120, 120, 120, 120, 120], { noise: 3 }));
    golden['noise level NaN'] = glucoseJS(makeEntries([120, 120, 120, 120, 120, 120], { noise: NaN }));

    // sgv field fallback
    const sgvEntries = makeEntries([120, 120, 120, 120]).map((e: any) => {
        const { glucose, ...rest } = e;
        return { ...rest, sgv: glucose };
    });
    golden['sgv field fallback'] = glucoseJS(sgvEntries);

    // dateString fallback
    const dateStringEntries = makeEntries([130, 125, 120]).map((e: any) => {
        const { date, ...rest } = e;
        return { ...rest, dateString: new Date(date).toISOString() };
    });
    golden['dateString fallback'] = glucoseJS(dateStringEntries);

    writeGolden('glucose-get-last', golden);
}

// =============================================================================
// MODULE: profile/isf
// =============================================================================
function generateProfileIsf() {
    console.log('\nGenerating: profile-isf');
    const golden: Record<string, unknown> = {};

    golden['single sensitivity'] = isfJS({ sensitivities: [{ offset: 0, sensitivity: 40 }] });
    golden['single sensitivity with timestamp'] = isfJS(
        { sensitivities: [{ offset: 0, sensitivity: 40 }] },
        new Date(FIXED_TIME),
    );
    golden['multiple sensitivities - midnight'] = isfJS(
        { sensitivities: [{ offset: 0, sensitivity: 50 }, { offset: 480, sensitivity: 40 }, { offset: 960, sensitivity: 35 }] },
        new Date('2025-01-15T02:00:00.000Z'),
    );
    golden['multiple sensitivities - noon'] = isfJS(
        { sensitivities: [{ offset: 0, sensitivity: 50 }, { offset: 480, sensitivity: 40 }, { offset: 960, sensitivity: 35 }] },
        new Date('2025-01-15T12:00:00.000Z'),
    );
    golden['multiple sensitivities - late evening'] = isfJS(
        { sensitivities: [{ offset: 0, sensitivity: 50 }, { offset: 480, sensitivity: 40 }, { offset: 960, sensitivity: 35 }] },
        new Date('2025-01-15T23:00:00.000Z'),
    );
    golden['first offset not zero'] = isfJS(
        { sensitivities: [{ offset: 60, sensitivity: 50 }] },
    );

    writeGolden('profile-isf', golden);
}

// =============================================================================
// MODULE: profile/targets
// =============================================================================
function generateProfileTargets() {
    console.log('\nGenerating: profile-targets');
    const golden: Record<string, unknown> = {};

    function makeInputs(overrides: Record<string, unknown> = {}) {
        return {
            targets: {
                user_preferred_units: 'mg/dL',
                targets: [{ offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 }],
                ...(overrides.targets as Record<string, unknown> || {}),
            },
            temptargets: overrides.temptargets ?? [],
        };
    }

    golden['single target'] = targetsJS(makeInputs(), {});
    golden['single target with timestamp'] = targetsJS(makeInputs(), {}, new Date(FIXED_TIME));
    golden['multiple targets - night'] = targetsJS(
        makeInputs({
            targets: {
                targets: [
                    { offset: 0, low: 100, high: 110, min_bg: 100, max_bg: 110 },
                    { offset: 480, low: 110, high: 120, min_bg: 110, max_bg: 120 },
                    { offset: 1080, low: 100, high: 110, min_bg: 100, max_bg: 110 },
                ],
            },
        }),
        {},
        new Date('2025-01-15T02:00:00.000Z'),
    );
    golden['active temp target'] = targetsJS(
        makeInputs({
            temptargets: [{ targetBottom: 80, targetTop: 80, duration: 60, created_at: ts(30) }],
        }),
        {},
        new Date(FIXED_TIME),
    );
    golden['expired temp target'] = targetsJS(
        makeInputs({
            temptargets: [{ targetBottom: 80, targetTop: 80, duration: 30, created_at: ts(60) }],
        }),
        {},
        new Date(FIXED_TIME),
    );
    golden['mmol/L conversion'] = targetsJS(
        makeInputs({
            targets: {
                user_preferred_units: 'mmol/L',
                targets: [{ offset: 0, low: 5.5, high: 6.5, min_bg: 5.5, max_bg: 6.5 }],
            },
        }),
        {},
        new Date(FIXED_TIME),
    );

    writeGolden('profile-targets', golden);
}

// =============================================================================
// MODULE: profile/carbs
// =============================================================================
function generateProfileCarbs() {
    console.log('\nGenerating: profile-carbs');
    const golden: Record<string, unknown> = {};

    function makeInputs(overrides: Record<string, unknown> = {}) {
        return {
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 10 }],
                ...(overrides.carbratio as Record<string, unknown> || {}),
            },
            ...overrides,
        };
    }

    golden['single ratio grams'] = carbsJS(makeInputs());
    golden['single ratio with timestamp'] = carbsJS(makeInputs(), {}, new Date(FIXED_TIME));
    golden['multiple ratios - morning'] = carbsJS(
        makeInputs({
            carbratio: { schedule: [{ offset: 0, ratio: 8 }, { offset: 480, ratio: 10 }, { offset: 960, ratio: 12 }] },
        }),
        {},
        new Date('2025-01-15T06:00:00.000Z'),
    );
    golden['exchanges units'] = carbsJS(
        makeInputs({ carbratio: { units: 'exchanges', schedule: [{ offset: 0, ratio: 15 }] } }),
    );
    golden['ratio out of bounds low'] = carbsJS(
        makeInputs({ carbratio: { schedule: [{ offset: 0, ratio: 0.5 }] } }),
    );
    golden['ratio out of bounds high'] = carbsJS(
        makeInputs({ carbratio: { schedule: [{ offset: 0, ratio: 200 }] } }),
    );
    golden['undefined carbratio'] = carbsJS({});

    writeGolden('profile-carbs', golden);
}

// =============================================================================
// MODULE: profile/index
// =============================================================================
function generateProfile() {
    console.log('\nGenerating: profile');
    const golden: Record<string, unknown> = {};

    function makeInputs(overrides: Record<string, unknown> = {}) {
        return {
            settings: { insulin_action_curve: 5, maxBasal: 3.5 },
            basals: [
                { minutes: 0, rate: 0.8 },
                { minutes: 360, rate: 0.9 },
                { minutes: 720, rate: 1.0 },
                { minutes: 1080, rate: 0.85 },
            ],
            targets: {
                user_preferred_units: 'mg/dL',
                targets: [{ offset: 0, low: 110, high: 120, min_bg: 110, max_bg: 120 }],
            },
            isf: {
                sensitivities: [{ offset: 0, sensitivity: 40 }],
            },
            carbratio: {
                units: 'grams',
                schedule: [{ offset: 0, ratio: 10 }],
            },
            temptargets: [],
            skip_neutral_temps: false,
            ...overrides,
        };
    }

    golden['standard profile'] = profileIndexJS(makeInputs());
    golden['DIA=3'] = profileIndexJS(makeInputs({ settings: { insulin_action_curve: 3, maxBasal: 3.5 } }));
    golden['DIA=7'] = profileIndexJS(makeInputs({ settings: { insulin_action_curve: 7, maxBasal: 3.5 } }));
    golden['invalid DIA'] = profileIndexJS(makeInputs({ settings: { insulin_action_curve: 0, maxBasal: 3.5 } }));
    golden['mmol/L units'] = profileIndexJS(makeInputs({
        targets: {
            user_preferred_units: 'mmol/L',
            targets: [{ offset: 0, low: 5.5, high: 6.5, min_bg: 5.5, max_bg: 6.5 }],
        },
    }));
    golden['with model 554'] = profileIndexJS(makeInputs({ model: '554' }));
    golden['with enableSMB_always'] = profileIndexJS(makeInputs({ enableSMB_always: true, enableUAM: true }));
    golden['with max_iob'] = profileIndexJS(makeInputs({ max_iob: 5 }));
    golden['with curve ultra-rapid'] = profileIndexJS(makeInputs({
        settings: { insulin_action_curve: 5, maxBasal: 3.5 },
        curve: 'ultra-rapid',
    }));
    golden['defaults'] = profileIndexJS.defaults();

    writeGolden('profile', golden);
}

// =============================================================================
// MODULE: iob/calculate
// =============================================================================
function generateIobCalculate() {
    console.log('\nGenerating: iob-calculate');
    const golden: Record<string, unknown> = {};

    function makeTreatment(insulin: number, minsAgo: number) {
        return {
            insulin,
            date: NOW - minsAgo * 60_000,
        };
    }

    const profile = {
        dia: 5,
        curve: 'rapid-acting',
        useCustomPeakTime: false,
        insulinPeakTime: 75,
    };

    // Rapid-acting curve at various time points
    const rapidTimes = [0, 5, 15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
    for (const t of rapidTimes) {
        golden[`rapid-acting 1U at ${t}m`] = iobCalcJS(
            makeTreatment(1, t), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile,
        );
    }
    golden['rapid-acting 2U at 60m'] = iobCalcJS(makeTreatment(2, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);
    golden['rapid-acting 0.5U at 30m'] = iobCalcJS(makeTreatment(0.5, 30), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);

    // Ultra-rapid curve
    const ultraTimes = [0, 15, 30, 55, 75, 120, 180, 300];
    for (const t of ultraTimes) {
        golden[`ultra-rapid 1U at ${t}m`] = iobCalcJS(
            makeTreatment(1, t), new Date(FIXED_TIME), 'ultra-rapid', 5, 55, { ...profile, curve: 'ultra-rapid', insulinPeakTime: 55 },
        );
    }

    // Bilinear curve DIA=3
    const bilinearTimes = [0, 15, 30, 45, 60, 75, 90, 120, 150, 180];
    for (const t of bilinearTimes) {
        golden[`bilinear 1U at ${t}m DIA=3`] = iobCalcJS(
            makeTreatment(1, t), new Date(FIXED_TIME), 'bilinear', 3, 75, { ...profile, curve: 'bilinear', dia: 3 },
        );
    }

    // Custom peak times
    golden['custom peak 50m rapid'] = iobCalcJS(
        makeTreatment(1, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 50, { ...profile, useCustomPeakTime: true, insulinPeakTime: 50 },
    );
    golden['custom peak 120m rapid'] = iobCalcJS(
        makeTreatment(1, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 120, { ...profile, useCustomPeakTime: true, insulinPeakTime: 120 },
    );
    golden['custom peak 35m ultra-rapid'] = iobCalcJS(
        makeTreatment(1, 60), new Date(FIXED_TIME), 'ultra-rapid', 5, 35, { ...profile, curve: 'ultra-rapid', useCustomPeakTime: true, insulinPeakTime: 35 },
    );

    // Edge cases
    golden['zero insulin'] = iobCalcJS(makeTreatment(0, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);
    golden['no insulin property'] = iobCalcJS({ date: NOW - 60 * 60_000 }, new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);
    golden['future treatment'] = iobCalcJS(makeTreatment(1, -10), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);
    golden['past DIA 360m'] = iobCalcJS(makeTreatment(1, 360), new Date(FIXED_TIME), 'rapid-acting', 5, 75, profile);

    // Peak clamping
    golden['peak clamped to 120 (rapid, peak=150)'] = iobCalcJS(
        makeTreatment(1, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 150, { ...profile, useCustomPeakTime: true, insulinPeakTime: 150 },
    );
    golden['peak clamped to 50 (rapid, peak=30)'] = iobCalcJS(
        makeTreatment(1, 60), new Date(FIXED_TIME), 'rapid-acting', 5, 30, { ...profile, useCustomPeakTime: true, insulinPeakTime: 30 },
    );

    writeGolden('iob-calculate', golden);
}

// =============================================================================
// MODULE: iob/total
// =============================================================================
function generateIobTotal() {
    console.log('\nGenerating: iob-total');
    const golden: Record<string, unknown> = {};

    function makeTreatment(insulin: number, minsAgo: number) {
        return {
            insulin,
            date: NOW - minsAgo * 60_000,
            started_at: new Date(NOW - minsAgo * 60_000).toISOString(),
        };
    }

    function makeOpts(treatments: any[], profileOverrides: Record<string, unknown> = {}) {
        return {
            treatments,
            profile: {
                dia: 5,
                curve: 'rapid-acting',
                useCustomPeakTime: false,
                insulinPeakTime: 75,
                ...profileOverrides,
            },
            calculate: iobCalcJS,
        };
    }

    const TIME = new Date(FIXED_TIME);

    // Single bolus at various times
    golden['1U at 0m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 0)]), TIME) as Record<string, unknown>);
    golden['1U at 30m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 30)]), TIME) as Record<string, unknown>);
    golden['1U at 60m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 60)]), TIME) as Record<string, unknown>);
    golden['1U at 120m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 120)]), TIME) as Record<string, unknown>);
    golden['1U at 240m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 240)]), TIME) as Record<string, unknown>);
    golden['1U at 300m (DIA boundary)'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 300)]), TIME) as Record<string, unknown>);
    golden['1U at 360m (past DIA)'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 360)]), TIME) as Record<string, unknown>);
    golden['2U at 60m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(2, 60)]), TIME) as Record<string, unknown>);
    golden['5U at 30m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(5, 30)]), TIME) as Record<string, unknown>);

    // Multiple treatments
    golden['two 1U at 30m and 60m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 30), makeTreatment(1, 60)]), TIME) as Record<string, unknown>);
    golden['stacked: 2U@10m + 1U@45m + 0.5U@90m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(2, 10), makeTreatment(1, 45), makeTreatment(0.5, 90)]), TIME) as Record<string, unknown>);

    // Basal-like treatments
    golden['small basal 0.05U at 30m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(0.05, 30)]), TIME) as Record<string, unknown>);

    // Different curves
    golden['ultra-rapid 1U at 60m'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 60)], { curve: 'ultra-rapid', insulinPeakTime: 55 }), TIME) as Record<string, unknown>);
    golden['bilinear 1U at 60m DIA=3'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 60)], { curve: 'bilinear', dia: 3 }), TIME) as Record<string, unknown>);
    golden['rapid-acting 1U at 60m DIA=7'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, 60)], { dia: 7 }), TIME) as Record<string, unknown>);

    // Edge cases
    golden['empty treatments'] = normalizeIobTotal(iobTotalJS(makeOpts([]), TIME) as Record<string, unknown>);
    golden['null treatments'] = normalizeIobTotal(iobTotalJS(makeOpts(null as any), TIME) as Record<string, unknown>);
    golden['future treatment'] = normalizeIobTotal(iobTotalJS(makeOpts([makeTreatment(1, -30)]), TIME) as Record<string, unknown>);

    writeGolden('iob-total', golden);
}

// =============================================================================
// MODULE: iob/index
// =============================================================================
function generateIobIndex() {
    console.log('\nGenerating: iob-index');
    const golden: Record<string, unknown> = {};

    function makeInputs(history: any[], profileOverrides: Record<string, unknown> = {}) {
        return {
            clock: FIXED_TIME,
            history,
            profile: {
                dia: 5,
                curve: 'rapid-acting',
                basalprofile: BASAL_PROFILE,
                current_basal: 1,
                max_daily_basal: 1,
                ...profileOverrides,
            },
        };
    }

    suppressConsole();

    // Single bolus tests
    golden['2U bolus just given'] = normalizeIobArray(iobIndexJS(makeInputs([{ _type: 'Bolus', amount: 2, timestamp: FIXED_TIME }])));
    golden['1U bolus 1h ago'] = normalizeIobArray(iobIndexJS(makeInputs([{ _type: 'Bolus', amount: 1, timestamp: ts(60) }])));
    golden['1U bolus past DIA (6h)'] = normalizeIobArray(iobIndexJS(makeInputs([{ _type: 'Bolus', amount: 1, timestamp: ts(360) }])));
    golden['two boluses'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: FIXED_TIME },
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
    ])));

    // Temp basal tests
    golden['high temp 2U/hr 30m'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));
    golden['zero temp 30m'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'TempBasal', rate: 0, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));
    golden['low temp 0.1U/hr with high basal'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'TempBasal', rate: 0.1, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ], { current_basal: 2 })));

    // Mixed
    golden['1U bolus + high temp'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));

    // Different curves
    golden['bilinear DIA=3'] = normalizeIobArray(iobIndexJS(makeInputs(
        [{ _type: 'Bolus', amount: 1, timestamp: ts(30) }],
        { curve: 'bilinear', dia: 3 },
    )));
    golden['ultra-rapid'] = normalizeIobArray(iobIndexJS(makeInputs(
        [{ _type: 'Bolus', amount: 1, timestamp: ts(30) }],
        { curve: 'ultra-rapid' },
    )));

    // Nightscout treatments
    golden['NS Meal Bolus'] = normalizeIobArray(iobIndexJS(makeInputs([
        { eventType: 'Meal Bolus', insulin: 3, created_at: ts(30) },
    ])));
    golden['NS Correction Bolus'] = normalizeIobArray(iobIndexJS(makeInputs([
        { eventType: 'Correction Bolus', insulin: 1.5, created_at: ts(60) },
    ])));

    // Suspend
    golden['suspend with suspend_zeros_iob'] = normalizeIobArray(iobIndexJS(makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
        { _type: 'PumpSuspend', timestamp: ts(30) },
        { _type: 'PumpResume', timestamp: ts(15) },
    ], { suspend_zeros_iob: true })));

    restoreConsole();

    writeGolden('iob-index', golden);
}

// =============================================================================
// MODULE: iob/history
// =============================================================================
function generateIobHistory() {
    console.log('\nGenerating: iob-history');
    const golden: Record<string, unknown> = {};

    function makeInputs(history: unknown[], profileOverrides: Record<string, unknown> = {}) {
        return {
            clock: FIXED_TIME,
            history,
            profile: {
                dia: 5,
                curve: 'rapid-acting',
                basalprofile: BASAL_PROFILE,
                current_basal: 1,
                max_daily_basal: 1,
                ...profileOverrides,
            },
        };
    }

    suppressConsole();

    // Basic bolus events
    golden['single bolus'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: ts(30) },
    ])));
    golden['multiple boluses'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'Bolus', amount: 2, timestamp: FIXED_TIME },
        { _type: 'Bolus', amount: 1, timestamp: ts(30) },
        { _type: 'Bolus', amount: 0.5, timestamp: ts(60) },
    ])));

    // TempBasal pairing
    golden['temp basal pair'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));
    golden['zero temp pair'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 0, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));

    // Percent-type temps (should be skipped)
    golden['percent temp skipped'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 50, temp: 'percent', timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));

    // Consecutive temps
    golden['consecutive temps'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 0, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));

    // Low temp negative IOB
    golden['low temp negative IOB'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 0.1, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ], { current_basal: 2 })));

    // PumpSuspend
    golden['pump suspend/resume'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'TempBasal', rate: 2, timestamp: ts(60) },
        { _type: 'TempBasalDuration', 'duration (min)': 60, timestamp: ts(60) },
        { _type: 'PumpSuspend', timestamp: ts(30) },
        { _type: 'PumpResume', timestamp: ts(15) },
    ], { suspend_zeros_iob: true })));

    // Care Portal treatments
    golden['Meal Bolus'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { eventType: 'Meal Bolus', insulin: 3, created_at: ts(30) },
    ])));
    golden['Correction Bolus'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { eventType: 'Correction Bolus', insulin: 1.5, created_at: ts(60) },
    ])));
    golden['Snack Bolus'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { eventType: 'Snack Bolus', insulin: 1, created_at: ts(45) },
    ])));
    golden['Bolus Wizard'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { eventType: 'Bolus Wizard', insulin: 2.5, created_at: ts(20) },
    ])));

    // xDrip entries
    golden['xDrip bolus'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { eventType: 'xDrip', insulin: 1.5, created_at: ts(40) },
    ])));

    // Mixed bolus + temp
    golden['mixed bolus and temp'] = normalizeIobHistory(iobHistoryJS(makeInputs([
        { _type: 'Bolus', amount: 1, timestamp: ts(60) },
        { _type: 'TempBasal', rate: 2, timestamp: ts(30) },
        { _type: 'TempBasalDuration', 'duration (min)': 30, timestamp: ts(30) },
    ])));

    // Empty history
    golden['empty history'] = normalizeIobHistory(iobHistoryJS(makeInputs([])));

    restoreConsole();

    writeGolden('iob-history', golden);
}

// =============================================================================
// MODULE: meal/history
// =============================================================================
function generateMealHistory() {
    console.log('\nGenerating: meal-history');
    const golden: Record<string, unknown> = {};

    function inputs(overrides: { history?: any[]; carbs?: any[]; profile?: any } = {}) {
        return {
            history: overrides.history ?? [],
            carbs: overrides.carbs ?? [],
            profile: overrides.profile ?? {},
        };
    }

    function sorted(results: any[]): any[] {
        return [...results].sort((a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
    }

    suppressConsole();

    golden['empty inputs'] = mealHistoryJS(inputs());
    golden['single carb entry'] = sorted(mealHistoryJS(inputs({
        carbs: [{ created_at: ts(30), carbs: 45 }],
    })));
    golden['multiple carb entries'] = sorted(mealHistoryJS(inputs({
        carbs: [
            { created_at: ts(30), carbs: 45 },
            { created_at: ts(120), carbs: 30 },
        ],
    })));
    golden['pump bolus'] = sorted(mealHistoryJS(inputs({
        history: [{ _type: 'Bolus', amount: 4, timestamp: ts(30) }],
    })));
    golden['Meal Bolus careportal'] = sorted(mealHistoryJS(inputs({
        history: [{ eventType: 'Meal Bolus', insulin: 3, carbs: 45, created_at: ts(30) }],
    })));
    golden['Correction Bolus'] = sorted(mealHistoryJS(inputs({
        history: [{ eventType: 'Correction Bolus', insulin: 1.5, created_at: ts(60) }],
    })));
    golden['carbs and bolus from different sources'] = sorted(mealHistoryJS(inputs({
        history: [{ _type: 'Bolus', amount: 4, timestamp: ts(30) }],
        carbs: [{ created_at: ts(30), carbs: 45 }],
    })));
    golden['duplicate entries deduplicated'] = sorted(mealHistoryJS(inputs({
        carbs: [
            { created_at: ts(30), carbs: 45 },
            { created_at: ts(30), carbs: 45 },
        ],
    })));

    restoreConsole();

    writeGolden('meal-history', golden);
}

// =============================================================================
// MODULE: meal/total
// =============================================================================
function generateMealTotal() {
    console.log('\nGenerating: meal-total');
    const golden: Record<string, unknown> = {};
    const TIME = new Date(FIXED_TIME);

    function makeGlucoseData(startBG: number, deltas: number[]) {
        const data: any[] = [];
        let bg = startBG;
        for (let i = 0; i <= deltas.length; i++) {
            data.push({
                glucose: Math.round(bg),
                dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            });
            if (i < deltas.length) bg -= deltas[i];
        }
        return data;
    }

    function makeProfile(overrides: Record<string, unknown> = {}) {
        return {
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 1,
            basalprofile: BASAL_PROFILE,
            min_5m_carbimpact: 8,
            carb_ratio: 10,
            sens: 40,
            isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
            maxMealAbsorptionTime: 6,
            max_daily_basal: 1,
            maxCOB: 120,
            ...overrides,
        };
    }

    function defaultGlucose() {
        return makeGlucoseData(120, [0, 0, 0, 0, 0, 0]);
    }

    function risingGlucose() {
        return makeGlucoseData(160, [5, 5, 5, 5, 5, 5]);
    }

    function makeOpts(treatments: any, overrides: { profile?: Record<string, unknown>; pumpHistory?: any[]; glucose?: any[] } = {}) {
        return {
            treatments,
            profile: makeProfile(overrides.profile || {}),
            pumphistory: overrides.pumpHistory || [],
            glucose: overrides.glucose || defaultGlucose(),
            basalprofile: BASAL_PROFILE,
        };
    }

    suppressConsole();

    golden['empty treatments'] = mealTotalJS(makeOpts([]), TIME);
    golden['null treatments'] = mealTotalJS(makeOpts(null), TIME);
    golden['single nsCarb 45g at 30m'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 45, nsCarbs: 45 },
    ]), TIME);
    golden['single bwCarb 30g at 30m'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 30, bwCarbs: 30 },
    ]), TIME);
    golden['single journalCarb 20g at 45m'] = mealTotalJS(makeOpts([
        { timestamp: ts(45), carbs: 20, journalCarbs: 20 },
    ]), TIME);
    golden['treatment outside window (7h ago)'] = mealTotalJS(makeOpts([
        { timestamp: ts(420), carbs: 45, nsCarbs: 45 },
    ]), TIME);
    golden['multiple treatments'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 25, nsCarbs: 25 },
        { timestamp: ts(120), carbs: 35, nsCarbs: 35 },
    ]), TIME);
    golden['maxCOB enforcement'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 100, nsCarbs: 100 },
    ], { profile: { maxCOB: 5 } }), TIME);
    golden['rising glucose'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 45, nsCarbs: 45 },
    ], { glucose: risingGlucose() }), TIME);
    golden['unclassified carbs'] = mealTotalJS(makeOpts([
        { timestamp: ts(30), carbs: 40 },
    ]), TIME);
    golden['future treatment'] = mealTotalJS(makeOpts([
        { timestamp: new Date(NOW + 30 * 60_000).toISOString(), carbs: 30, nsCarbs: 30 },
    ]), TIME);

    restoreConsole();

    writeGolden('meal-total', golden);
}

// =============================================================================
// MODULE: meal/index
// =============================================================================
function generateMealIndex() {
    console.log('\nGenerating: meal-index');
    const golden: Record<string, unknown> = {};

    function makeGlucoseData(startBG: number, deltas: number[]) {
        const data: any[] = [];
        let bg = startBG;
        for (let i = 0; i <= deltas.length; i++) {
            data.push({
                glucose: Math.round(bg),
                dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            });
            if (i < deltas.length) bg -= deltas[i];
        }
        return data;
    }

    function makeProfile(overrides: Record<string, unknown> = {}) {
        return {
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 1,
            basalprofile: BASAL_PROFILE,
            min_5m_carbimpact: 8,
            carb_ratio: 10,
            sens: 40,
            isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
            maxMealAbsorptionTime: 6,
            max_daily_basal: 1,
            maxCOB: 120,
            ...overrides,
        };
    }

    function defaultGlucose() {
        return makeGlucoseData(120, [0, 0, 0, 0, 0, 0]);
    }

    function makeInputs(overrides: { history?: any[]; carbs?: any[]; profile?: any; glucose?: any[]; basalProfile?: any[] } = {}) {
        return {
            clock: FIXED_TIME,
            history: overrides.history ?? [],
            carbs: overrides.carbs ?? [],
            profile: overrides.profile ?? makeProfile(),
            glucose: overrides.glucose ?? defaultGlucose(),
            basalprofile: overrides.basalProfile ?? BASAL_PROFILE,
        };
    }

    suppressConsole();

    golden['empty inputs'] = mealIndexJS(makeInputs());
    golden['single carb entry from NS'] = mealIndexJS(makeInputs({
        carbs: [{ created_at: ts(30), carbs: 45 }],
    }));
    golden['pump bolus with NS carbs'] = mealIndexJS(makeInputs({
        history: [{ _type: 'Bolus', amount: 4, timestamp: ts(30) }],
        carbs: [{ created_at: ts(30), carbs: 40 }],
    }));
    golden['mixed NS carbs and pump boluses'] = mealIndexJS(makeInputs({
        history: [{ _type: 'Bolus', amount: 3, timestamp: ts(30) }],
        carbs: [
            { created_at: ts(90), carbs: 50 },
            { created_at: ts(30), carbs: 20 },
        ],
    }));
    golden['flat glucose with carbs'] = mealIndexJS(makeInputs({
        carbs: [{ created_at: ts(60), carbs: 30 }],
        glucose: defaultGlucose(),
    }));
    golden['maxCOB 10'] = mealIndexJS(makeInputs({
        carbs: [{ created_at: ts(30), carbs: 100 }],
        profile: makeProfile({ maxCOB: 10 }),
    }));

    restoreConsole();

    writeGolden('meal-index', golden);
}

// =============================================================================
// MODULE: cob
// =============================================================================
function generateCob() {
    console.log('\nGenerating: cob');
    const golden: Record<string, unknown> = {};

    function makeGlucoseData(startBG: number, deltas: number[]) {
        const data: any[] = [];
        let bg = startBG;
        for (let i = 0; i <= deltas.length; i++) {
            data.push({
                glucose: Math.round(bg),
                dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
            });
            if (i < deltas.length) bg -= deltas[i];
        }
        return data;
    }

    function makeProfile(overrides: Record<string, unknown> = {}) {
        return {
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 1,
            basalprofile: BASAL_PROFILE,
            min_5m_carbimpact: 8,
            carb_ratio: 10,
            sens: 40,
            isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
            maxMealAbsorptionTime: 6,
            max_daily_basal: 1,
            ...overrides,
        };
    }

    function makeInputs(glucoseData: any[], mealTimeMinsAgo: number, overrides: { profile?: Record<string, unknown>; history?: any[] } = {}) {
        const profile = makeProfile(overrides.profile || {});
        return {
            glucose_data: glucoseData,
            iob_inputs: {
                profile,
                history: overrides.history || [],
                clock: FIXED_TIME,
            },
            basalprofile: BASAL_PROFILE,
            mealTime: NOW - mealTimeMinsAgo * 60_000,
        };
    }

    suppressConsole();

    // Steady BG, no meal
    golden['steady 120 no meal'] = cobJS(makeInputs(
        makeGlucoseData(120, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        180,
    ));

    // Rising BG after meal
    golden['rising +5/5m meal 30m ago'] = cobJS(makeInputs(
        makeGlucoseData(160, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
        30,
    ));
    golden['rising +10/5m meal 15m ago'] = cobJS(makeInputs(
        makeGlucoseData(180, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
        15,
    ));

    // Falling BG
    golden['falling -5/5m meal 120m ago'] = cobJS(makeInputs(
        makeGlucoseData(120, [-5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5]),
        120,
    ));

    // Past absorption window
    golden['past maxMealAbsorptionTime'] = cobJS(makeInputs(
        makeGlucoseData(120, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        400,
    ));

    // High min_5m_carbimpact
    golden['high min_5m_carbimpact=20'] = cobJS(makeInputs(
        makeGlucoseData(140, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
        30,
        { profile: { min_5m_carbimpact: 20 } },
    ));

    restoreConsole();

    writeGolden('cob', golden);
}

// =============================================================================
// MODULE: autosens
// =============================================================================
function generateAutosens() {
    console.log('\nGenerating: autosens');
    const golden: Record<string, unknown> = {};

    function makeUniformGlucoseData(startBG: number, count: number, deltaPerReading: number = 0) {
        const data: any[] = [];
        for (let i = 0; i < count; i++) {
            const bg = Math.round(startBG - deltaPerReading * i);
            data.push({
                glucose: bg,
                dateString: new Date(NOW - i * 5 * 60_000).toISOString(),
                date: NOW - i * 5 * 60_000,
            });
        }
        return data;
    }

    function makeInputs(glucoseData: any[], overrides: Record<string, unknown> = {}) {
        const base: any = {
            glucose_data: glucoseData,
            iob_inputs: {
                profile: {
                    dia: 5,
                    curve: 'rapid-acting',
                    useCustomPeakTime: false,
                    insulinPeakTime: 75,
                    current_basal: 1,
                    basalprofile: BASAL_PROFILE,
                    min_5m_carbimpact: 8,
                    carb_ratio: 10,
                    sens: 40,
                    isfProfile: { sensitivities: [{ offset: 0, sensitivity: 40 }] },
                    max_daily_basal: 1,
                    autosens_min: 0.7,
                    autosens_max: 1.2,
                    rewind_resets_autosens: true,
                    high_temptarget_raises_sensitivity: false,
                    exercise_mode: false,
                    temptargetSet: false,
                    maxMealAbsorptionTime: 6,
                },
                history: [],
                clock: FIXED_TIME,
            },
            basalprofile: BASAL_PROFILE,
            carbs: [],
            temptargets: [],
            retrospective: true,
            ...overrides,
        };

        if (overrides.profileOverrides) {
            Object.assign(base.iob_inputs.profile, overrides.profileOverrides);
            delete base.profileOverrides;
        }
        if (overrides.history !== undefined) {
            base.iob_inputs.history = overrides.history;
            delete base.history;
        }

        return base;
    }

    suppressConsole();

    // Steady BG
    golden['steady 120 48 readings'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 48),
    ));

    // Rising BG
    golden['rising +1/5m 48 readings'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 48, -1),
    ));
    golden['rising +3/5m 48 readings'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 48, -3),
    ));

    // Falling BG
    golden['falling -1/5m 48 readings'] = autosensJS(makeInputs(
        makeUniformGlucoseData(168, 48, 1),
    ));
    golden['falling -3/5m 48 readings'] = autosensJS(makeInputs(
        makeUniformGlucoseData(264, 48, 3),
    ));

    // Ratio bounds
    golden['bounds: ratio clamped to autosens_min'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 48, -5),
        { profileOverrides: { autosens_min: 0.8, autosens_max: 1.5 } },
    ));
    golden['bounds: ratio clamped to autosens_max'] = autosensJS(makeInputs(
        makeUniformGlucoseData(300, 48, 5),
        { profileOverrides: { autosens_min: 0.7, autosens_max: 1.1 } },
    ));

    // Few readings
    golden['minimal: 8 readings steady'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 8),
    ));

    // High temp target
    golden['high temp target raises sensitivity'] = autosensJS(makeInputs(
        makeUniformGlucoseData(120, 48),
        {
            profileOverrides: {
                high_temptarget_raises_sensitivity: true,
                temptargetSet: true,
            },
            temptargets: [{ targetBottom: 160, targetTop: 160, duration: 120, created_at: ts(60) }],
        },
    ));

    restoreConsole();

    writeGolden('autosens', golden);
}

// =============================================================================
// MODULE: autotune
// =============================================================================
function generateAutotune() {
    console.log('\nGenerating: autotune');
    const golden: Record<string, unknown> = {};

    const AUTOTUNE_BASAL_PROFILE = [{ i: 0, start: '00:00:00', rate: 0.8, minutes: 0 }];
    const ISF_PROFILE = { sensitivities: [{ offset: 0, sensitivity: 100, endOffset: 1440 }] };

    function makePreviousAutotune(overrides: Record<string, unknown> = {}) {
        return {
            basalprofile: JSON.parse(JSON.stringify(AUTOTUNE_BASAL_PROFILE)),
            isfProfile: JSON.parse(JSON.stringify(ISF_PROFILE)),
            sens: 100,
            carb_ratio: 10,
            csf: 10,
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            min_5m_carbimpact: 8,
            ...overrides,
        };
    }

    function makePumpProfile(overrides: Record<string, unknown> = {}) {
        return {
            basalprofile: JSON.parse(JSON.stringify(AUTOTUNE_BASAL_PROFILE)),
            isfProfile: JSON.parse(JSON.stringify(ISF_PROFILE)),
            sens: 100,
            carb_ratio: 10,
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            autosens_min: 0.7,
            autosens_max: 1.2,
            autotune_isf_adjustmentFraction: 1.0,
            ...overrides,
        };
    }

    function makeBasalDatum(hour: number, deviation: number, overrides: Record<string, unknown> = {}) {
        const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:00:00.000Z`);
        return {
            glucose: 120,
            date: d.getTime(),
            dateString: d.toISOString(),
            deviation,
            BGI: -1.0,
            avgDelta: 0,
            ...overrides,
        };
    }

    function makeISFDatum(hour: number, deviation: number, BGI: number, overrides: Record<string, unknown> = {}) {
        const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:15:00.000Z`);
        return {
            glucose: 180,
            date: d.getTime(),
            dateString: d.toISOString(),
            deviation,
            BGI,
            avgDelta: deviation + BGI,
            ...overrides,
        };
    }

    function makeCSFDatum(hour: number, deviation: number, mealCarbs: number, mealAbsorption?: string, overrides: Record<string, unknown> = {}) {
        const d = new Date(`2025-01-15T${String(hour).padStart(2, '0')}:30:00.000Z`);
        return {
            glucose: 140,
            date: d.getTime(),
            dateString: d.toISOString(),
            deviation,
            BGI: -0.5,
            avgDelta: deviation - 0.5,
            mealCarbs,
            ...(mealAbsorption ? { mealAbsorption } : {}),
            ...overrides,
        };
    }

    function makeCRDatum(overrides: Record<string, unknown> = {}) {
        return {
            CRInitialIOB: 0.5,
            CRInitialBG: 110,
            CRInitialCarbTime: new Date('2025-01-15T10:00:00.000Z'),
            CREndIOB: 0.1,
            CREndBG: 140,
            CREndTime: new Date('2025-01-15T13:00:00.000Z'),
            CRCarbs: 45,
            CRInsulin: 3.0,
            ...overrides,
        };
    }

    function makeInputs(overrides: Record<string, unknown> = {}) {
        return {
            previousAutotune: makePreviousAutotune(),
            pumpProfile: makePumpProfile(),
            preppedGlucose: {
                CRData: [],
                CSFGlucoseData: [],
                ISFGlucoseData: [],
                basalGlucoseData: [],
            },
            ...overrides,
        };
    }

    suppressConsole();

    // Empty data
    golden['empty prepped glucose'] = autotuneJS(makeInputs());

    // Basal tuning
    golden['basal: positive deviation at hour 12'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [],
            basalGlucoseData: [makeBasalDatum(12, 5)],
        },
    }));
    golden['basal: negative deviation at hour 12'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [],
            basalGlucoseData: [makeBasalDatum(12, -5)],
        },
    }));
    golden['basal: multiple hours'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [],
            basalGlucoseData: [
                makeBasalDatum(6, 3),
                makeBasalDatum(12, -2),
                makeBasalDatum(18, 1),
            ],
        },
    }));

    // ISF tuning
    golden['ISF: positive deviation'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [makeISFDatum(12, 10, -5)],
            basalGlucoseData: [],
        },
    }));
    golden['ISF: negative deviation'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [makeISFDatum(12, -10, -5)],
            basalGlucoseData: [],
        },
    }));

    // CSF tuning
    golden['CSF: with meal carbs'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [makeCSFDatum(12, 8, 45)],
            ISFGlucoseData: [],
            basalGlucoseData: [],
        },
    }));

    // CR tuning
    golden['CR: single datum'] = autotuneJS(makeInputs({
        preppedGlucose: {
            CRData: [makeCRDatum()],
            CSFGlucoseData: [],
            ISFGlucoseData: [],
            basalGlucoseData: [],
        },
    }));

    // Bounds enforcement
    golden['bounds: autosens_max limits ratio'] = autotuneJS(makeInputs({
        pumpProfile: makePumpProfile({ autosens_max: 1.1 }),
        preppedGlucose: {
            CRData: [],
            CSFGlucoseData: [],
            ISFGlucoseData: [
                makeISFDatum(10, 20, -5),
                makeISFDatum(11, 20, -5),
                makeISFDatum(12, 20, -5),
            ],
            basalGlucoseData: [],
        },
    }));

    restoreConsole();

    writeGolden('autotune', golden);
}

// =============================================================================
// MODULE: autotune-prep
// =============================================================================
function generateAutotunePrep() {
    console.log('\nGenerating: autotune-prep');
    const golden: Record<string, unknown> = {};

    const ISF_PROFILE = { sensitivities: [{ offset: 0, sensitivity: 40, endOffset: 1440 }] };

    function makeProfile(overrides: Record<string, unknown> = {}) {
        return {
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 1.0,
            basalprofile: BASAL_PROFILE,
            min_5m_carbimpact: 8,
            carb_ratio: 10,
            sens: 40,
            isfProfile: ISF_PROFILE,
            max_daily_basal: 1.3,
            autosens_min: 0.7,
            autosens_max: 1.2,
            ...overrides,
        };
    }

    function makePumpProfile(overrides: Record<string, unknown> = {}) {
        return {
            basalprofile: BASAL_PROFILE,
            dia: 5,
            curve: 'rapid-acting',
            useCustomPeakTime: false,
            insulinPeakTime: 75,
            current_basal: 1.0,
            carb_ratio: 10,
            sens: 40,
            isfProfile: ISF_PROFILE,
            autosens_min: 0.7,
            autosens_max: 1.2,
            ...overrides,
        };
    }

    function makeGlucoseSeries(startBG: number, count: number, deltaPerReading: number = 0, startMinsAgo?: number) {
        const oldest = startMinsAgo ?? (count - 1) * 5;
        const data: any[] = [];
        for (let i = 0; i < count; i++) {
            const minsAgo = oldest - i * 5;
            const bg = Math.round(startBG + deltaPerReading * i);
            data.push({
                glucose: bg,
                date: NOW - minsAgo * 60_000,
                dateString: new Date(NOW - minsAgo * 60_000).toISOString(),
            });
        }
        return data.reverse();
    }

    function makeInputs(overrides: Record<string, unknown> = {}) {
        return {
            history: [],
            profile: makeProfile(),
            pumpprofile: makePumpProfile(),
            carbs: [],
            glucose: [],
            categorize_uam_as_basal: false,
            tune_insulin_curve: false,
            ...overrides,
        };
    }

    suppressConsole();

    function tryAutotunePrep(name: string, inputs: any) {
        try {
            golden[name] = autotunePrepJS(inputs);
        } catch (e: any) {
            golden[name] = { _error: e.message };
        }
    }

    tryAutotunePrep('empty inputs', makeInputs());
    tryAutotunePrep('flat glucose no history', makeInputs({
        glucose: makeGlucoseSeries(120, 48),
    }));
    tryAutotunePrep('rising glucose no history', makeInputs({
        glucose: makeGlucoseSeries(100, 48, 1),
    }));
    tryAutotunePrep('falling glucose no history', makeInputs({
        glucose: makeGlucoseSeries(200, 48, -1),
    }));
    tryAutotunePrep('with bolus history', makeInputs({
        history: [{ _type: 'Bolus', amount: 3, timestamp: ts(120) }],
        glucose: makeGlucoseSeries(120, 48),
    }));
    tryAutotunePrep('with carbs', makeInputs({
        carbs: [{ created_at: ts(120), carbs: 45 }],
        glucose: makeGlucoseSeries(120, 48, 1),
    }));
    tryAutotunePrep('categorize UAM as basal', makeInputs({
        glucose: makeGlucoseSeries(100, 48, 2),
        categorize_uam_as_basal: true,
    }));

    restoreConsole();

    writeGolden('autotune-prep', golden);
}


// =============================================================================
// MAIN
// =============================================================================
console.log('╔═══════════════════════════════════════════════════╗');
console.log('║  Golden Output Generation — Original JS (lib/)   ║');
console.log('╚═══════════════════════════════════════════════════╝');
console.log(`\nSource: ${LIB}`);
console.log(`Output: ${OUTPUT_DIR}\n`);

generateDetermineBasal();
generateBasalSetTemp();
generateGlucoseGetLast();
generateProfileIsf();
generateProfileTargets();
generateProfileCarbs();
generateProfile();
generateIobCalculate();
generateIobTotal();
generateIobIndex();
generateIobHistory();
generateMealHistory();
generateMealTotal();
generateMealIndex();
generateCob();
generateAutosens();
generateAutotune();
generateAutotunePrep();

console.log('\n✓ All golden outputs generated successfully.');
console.log(`Output directory: ${OUTPUT_DIR}`);
