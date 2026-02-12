/**
 * Characterization tests for percentile.js
 *
 * Tests the percentile calculation using linear interpolation between
 * closest ranks. Captures exact behavior for empty arrays, boundary
 * percentiles, mid-range interpolation, and unsorted input.
 */

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const percentile = require('../../../lib/percentile');

describe('percentile characterization tests', () => {
  describe('empty array', () => {
    it('returns 0 for empty array', () => {
      expect(percentile([], 0.5)).toMatchSnapshot();
    });
  });

  describe('single element', () => {
    it('p=0 returns the only element', () => {
      expect(percentile([42], 0)).toMatchSnapshot();
    });

    it('p=0.5 returns the only element', () => {
      expect(percentile([42], 0.5)).toMatchSnapshot();
    });

    it('p=1 returns the only element', () => {
      expect(percentile([42], 1)).toMatchSnapshot();
    });
  });

  describe('boundary percentiles', () => {
    it('p=0 returns first element of sorted array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0)).toMatchSnapshot();
    });

    it('p=1 returns last element of sorted array', () => {
      expect(percentile([10, 20, 30, 40, 50], 1)).toMatchSnapshot();
    });

    it('p less than 0 returns first element', () => {
      expect(percentile([10, 20, 30, 40, 50], -0.1)).toMatchSnapshot();
    });

    it('p greater than 1 returns last element', () => {
      expect(percentile([10, 20, 30, 40, 50], 1.5)).toMatchSnapshot();
    });
  });

  describe('mid-range percentiles', () => {
    it('p=0.5 on even-length sorted array', () => {
      expect(percentile([10, 20, 30, 40], 0.5)).toMatchSnapshot();
    });

    it('p=0.5 on odd-length sorted array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.5)).toMatchSnapshot();
    });

    it('p=0.25 on multi-element array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.25)).toMatchSnapshot();
    });

    it('p=0.75 on multi-element array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.75)).toMatchSnapshot();
    });

    it('p=0.1 on multi-element array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.1)).toMatchSnapshot();
    });

    it('p=0.9 on multi-element array', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.9)).toMatchSnapshot();
    });
  });

  describe('two-element array', () => {
    it('p=0.5 interpolates midpoint', () => {
      expect(percentile([100, 200], 0.5)).toMatchSnapshot();
    });

    it('p=0.25 interpolates quarter', () => {
      expect(percentile([100, 200], 0.25)).toMatchSnapshot();
    });

    it('p=0.75 interpolates three-quarter', () => {
      expect(percentile([100, 200], 0.75)).toMatchSnapshot();
    });
  });

  describe('unsorted array behavior', () => {
    it('unsorted array — captures actual behavior (no internal sorting)', () => {
      // The function assumes the array is pre-sorted. With unsorted input,
      // it will still index into it as-is, producing potentially wrong results.
      // This test captures that exact behavior.
      expect(percentile([50, 10, 40, 20, 30], 0.5)).toMatchSnapshot();
    });

    it('reverse-sorted array', () => {
      expect(percentile([50, 40, 30, 20, 10], 0.25)).toMatchSnapshot();
    });
  });

  describe('identical elements', () => {
    it('all elements the same', () => {
      expect(percentile([100, 100, 100, 100], 0.5)).toMatchSnapshot();
    });
  });

  describe('floating-point values', () => {
    it('array with decimal values', () => {
      expect(percentile([1.5, 2.5, 3.5, 4.5, 5.5], 0.5)).toMatchSnapshot();
    });

    it('p=0.33 fractional percentile', () => {
      expect(percentile([10, 20, 30, 40, 50], 0.33)).toMatchSnapshot();
    });
  });
});
