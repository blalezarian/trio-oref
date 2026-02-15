/**
 * Bundle export guard — verifies that each webpack bundle exposes its
 * global variable as the correct type (function or object with methods).
 *
 * Swift's JavaScriptCore calls these globals directly, so if a bundle
 * accidentally exposes a module namespace ({ default: fn }) instead of
 * the function itself, the app will crash at runtime.
 *
 * Requires `pnpm webpack` to have been run first (dist/bundle/ must exist).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import vm from 'vm';

const BUNDLE_DIR = resolve(__dirname, '../../dist/bundle');

/** Each entry: [bundle filename, global variable name, expected type] */
const BUNDLES: Array<[string, string, 'function' | 'object', string[]?]> = [
    ['determine-basal.js', 'trio_determineBasal', 'function'],
    ['glucose-get-last.js', 'trio_glucoseGetLast', 'function'],
    ['basal-set-temp.js', 'trio_basalSetTemp', 'object', ['getMaxSafeBasal', 'setTempBasal']],
    ['iob.js', 'trio_iob', 'function'],
    ['meal.js', 'trio_meal', 'function'],
    ['autosens.js', 'trio_autosens', 'function'],
    ['profile.js', 'trio_profile', 'function'],
    ['autotune-prep.js', 'trio_autotunePrep', 'function'],
    ['autotune-core.js', 'trio_autotuneCore', 'function'],
];

describe('bundle exports', () => {
    const bundlesExist = existsSync(resolve(BUNDLE_DIR, 'determine-basal.js'));

    if (!bundlesExist) {
        it.skip('dist/bundle/ not found — run pnpm webpack first', () => {});
        return;
    }

    for (const [filename, globalName, expectedType, methods] of BUNDLES) {
        it(`${globalName} is a ${expectedType}`, () => {
            const bundlePath = resolve(BUNDLE_DIR, filename);
            const code = readFileSync(bundlePath, 'utf8');

            // Run bundle in isolated context — the var declaration creates the global
            const context: Record<string, unknown> = { console };
            vm.createContext(context);
            vm.runInContext(code, context);

            const exported = context[globalName];
            expect(typeof exported).toBe(expectedType);

            // For object exports, verify expected methods exist
            if (methods) {
                for (const method of methods) {
                    expect(typeof (exported as Record<string, unknown>)[method]).toBe('function');
                }
            }
        });
    }
});
