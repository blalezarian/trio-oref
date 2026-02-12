/**
 * Characterization tests for medtronic-clock.js
 *
 * Tests getTime(minutes) which creates a Date at midnight of the current
 * day plus a minutes offset, returning milliseconds since epoch.
 * Uses fake timers for deterministic snapshots.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import getTime from '../../../lib/medtronic-clock.js';

const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

describe('medtronic-clock characterization tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('standard minute offsets', () => {
    it('0 minutes — midnight', () => {
      expect(getTime(0)).toMatchSnapshot();
    });

    it('360 minutes — 6:00 AM', () => {
      expect(getTime(360)).toMatchSnapshot();
    });

    it('720 minutes — noon', () => {
      expect(getTime(720)).toMatchSnapshot();
    });

    it('1080 minutes — 6:00 PM', () => {
      expect(getTime(1080)).toMatchSnapshot();
    });

    it('1440 minutes — next midnight', () => {
      expect(getTime(1440)).toMatchSnapshot();
    });
  });

  describe('edge cases', () => {
    it('negative minutes — before midnight', () => {
      expect(getTime(-60)).toMatchSnapshot();
    });

    it('negative 360 minutes — 6 hours before midnight', () => {
      expect(getTime(-360)).toMatchSnapshot();
    });

    it('fractional minutes', () => {
      expect(getTime(30.5)).toMatchSnapshot();
    });

    it('very large minute value', () => {
      expect(getTime(2880)).toMatchSnapshot();
    });

    it('1 minute', () => {
      expect(getTime(1)).toMatchSnapshot();
    });
  });
});
