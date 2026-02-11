/**
 * Characterization tests for determine-basal.
 *
 * These tests capture the EXACT current behavior of the JS algorithm.
 * Any change that alters the algorithm's output will cause a snapshot
 * mismatch, forcing explicit review before acceptance.
 *
 * SAFETY: This is the primary safety net for the TypeScript refactor.
 * Do not update snapshots without understanding why they changed.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { generateAllFixtures } from '../helpers/fixtures.js';

// Use createRequire to load the JS modules in CJS mode.
// The original JS uses implicit globals (e.g. `tdd_before = tdd`) which
// only work in CJS sloppy mode — ESM import would run them in strict mode
// and throw ReferenceError.
const require = createRequire(import.meta.url);
const determine_basal = require('../../../lib/determine-basal/determine-basal');
const tempBasalFunctions = require('../../../lib/basal-set-temp');

/**
 * Normalize the output for stable snapshots:
 * - Dates are converted to ISO strings
 * - Numbers are rounded to avoid floating point noise
 * - The 'deliverAt' timestamp is replaced with a stable placeholder
 */
function normalizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...output };

  // Replace deliverAt with stable value (it's always "now" which varies per run)
  if (normalized.deliverAt instanceof Date) {
    normalized.deliverAt = '[DELIVER_AT]';
  } else if (typeof normalized.deliverAt === 'string') {
    normalized.deliverAt = '[DELIVER_AT]';
  }

  // Round floating-point fields to avoid platform-specific precision issues
  for (const key of Object.keys(normalized)) {
    const val = normalized[key];
    if (typeof val === 'number' && !Number.isInteger(val)) {
      normalized[key] = Math.round(val * 10000) / 10000;
    }
  }

  // Normalize predBGs arrays (round each value)
  if (normalized.predBGs && typeof normalized.predBGs === 'object') {
    const predBGs = normalized.predBGs as Record<string, number[]>;
    for (const curve of Object.keys(predBGs)) {
      if (Array.isArray(predBGs[curve])) {
        predBGs[curve] = predBGs[curve].map((v: number) => Math.round(v));
      }
    }
    normalized.predBGs = predBGs;
  }

  return normalized;
}

// Generate all fixtures
const fixtures = generateAllFixtures();

// Group fixtures by category for organized test output
const categories = new Map<string, typeof fixtures>();
for (const f of fixtures) {
  const group = categories.get(f.category) ?? [];
  group.push(f);
  categories.set(f.category, group);
}

describe('determine-basal characterization tests', () => {
  for (const [category, categoryFixtures] of categories) {
    describe(category, () => {
      for (const f of categoryFixtures) {
        it(f.name, () => {
          const {
            glucose_status,
            currenttemp,
            iob_data,
            profile,
            autosens_data,
            meal_data,
            microBolusAllowed,
            reservoir_data,
            currentTime,
            pumphistory,
            preferences,
            basalprofile,
            trio_custom_variables,
            middleWare,
          } = f.input;

          const output = determine_basal(
            glucose_status,
            currenttemp,
            iob_data,
            profile,
            autosens_data,
            meal_data,
            tempBasalFunctions,
            microBolusAllowed,
            reservoir_data,
            currentTime,
            pumphistory,
            preferences,
            basalprofile,
            trio_custom_variables,
            middleWare,
          );

          const normalized = normalizeOutput(output);
          expect(normalized).toMatchSnapshot();
        });
      }
    });
  }
});
