/**
 * Characterization tests for autotune-prep/dosed.js
 *
 * Tests insulinDosed(opts) which sums insulin from treatments within
 * a given time window (start, end]. Returns { insulin: roundedTotal }.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import insulinDosed from '../../../src/autotune-prep/dosed';

const BASE_TIME = new Date('2025-01-15T12:00:00.000Z').getTime();

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    start: new Date(BASE_TIME - 60 * 60_000), // 1 hour before BASE_TIME
    end: new Date(BASE_TIME),
    treatments: [],
    profile: {},
    ...overrides,
  };
}

describe('autotune-prep/dosed characterization tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('no treatments', () => {
    it('undefined treatments returns empty object', () => {
      const opts = makeOpts({ treatments: undefined });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('empty treatments array returns zero insulin', () => {
      const opts = makeOpts({ treatments: [] });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });
  });

  describe('single treatment in window', () => {
    it('treatment at midpoint of window', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 2.5, date: BASE_TIME - 30 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatment exactly at end boundary (inclusive)', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 1.0, date: BASE_TIME },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatment exactly at start boundary (exclusive)', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 1.0, date: BASE_TIME - 60 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });
  });

  describe('multiple treatments', () => {
    it('multiple treatments all within window', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 1.5, date: BASE_TIME - 10 * 60_000 },
          { insulin: 2.0, date: BASE_TIME - 20 * 60_000 },
          { insulin: 0.5, date: BASE_TIME - 30 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatments with floating-point insulin values', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 0.333, date: BASE_TIME - 10 * 60_000 },
          { insulin: 0.667, date: BASE_TIME - 20 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });
  });

  describe('treatments outside window', () => {
    it('treatment before window start', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 5.0, date: BASE_TIME - 90 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatment after window end', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 5.0, date: BASE_TIME + 10 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('mix of in-window and out-of-window treatments', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 1.0, date: BASE_TIME - 30 * 60_000 },  // in window
          { insulin: 3.0, date: BASE_TIME - 90 * 60_000 },  // before window
          { insulin: 2.0, date: BASE_TIME + 10 * 60_000 },  // after window
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });
  });

  describe('treatment with no insulin field', () => {
    it('treatment without insulin property is ignored', () => {
      const opts = makeOpts({
        treatments: [
          { date: BASE_TIME - 15 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatment with insulin=0 is falsy, not counted', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 0, date: BASE_TIME - 15 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('treatment with insulin=null is falsy, not counted', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: null, date: BASE_TIME - 15 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });

    it('mix of treatments with and without insulin', () => {
      const opts = makeOpts({
        treatments: [
          { insulin: 2.5, date: BASE_TIME - 10 * 60_000 },
          { carbs: 30, date: BASE_TIME - 20 * 60_000 },  // no insulin field
          { insulin: 1.5, date: BASE_TIME - 30 * 60_000 },
        ],
      });
      expect(insulinDosed(opts)).toMatchSnapshot();
    });
  });
});
