import { describe, it, expect } from 'vitest';

import { withRawGlucose } from '../../src/glucose/withRawGlucose';

const cals = [{
  scale: 1
  , intercept: 25717.82377004309
  , slope: 766.895601715918
}] as any;

describe('IOB', () => {
  it('should add raw glucose and not mess with real glucose', () => {
    const entry = {unfiltered: 113680, filtered: 111232, glucose: 110, noise: 1} as any;
    withRawGlucose(entry, cals);

    expect(entry.glucose).toBe(110);
    expect(entry.raw).toBe(113);
    expect(entry.noise).toBe(1);
  });

  it('should add raw glucose and not mess with sgv from NS', () => {
    const entry = {unfiltered: 113680, filtered: 111232, sgv: 110, noise: 1} as any;
    withRawGlucose(entry, cals);

    expect(entry.glucose).toBeUndefined();
    expect(entry.sgv).toBe(110);
    expect(entry.raw).toBe(113);
    expect(entry.noise).toBe(1);
  });

  it('should add raw glucose and set missing glucose', () => {
    const entry = {unfiltered: 113680, filtered: 111232, noise: 1} as any;
    withRawGlucose(entry, cals);

    expect(entry.glucose).toBe(115);
    expect(entry.raw).toBe(115);
    expect(entry.noise).toBe(2);
  });

  it('should add raw glucose, but set set noise to 3 when glucose above maxRaw', () => {
    const entry = {unfiltered: 143680, filtered: 141232, noise: 1} as any;
    withRawGlucose(entry, cals, 150);

    //should.not.exist(entry.glucose);
    expect(entry.raw).toBe(154);
    expect(entry.noise).toBe(3);
  });

  it('should add raw glucose, and set missing glucose when maxRaw is higher', () => {
    const entry = {unfiltered: 143680, filtered: 141232, noise: 1} as any;
    withRawGlucose(entry, cals, 250);

    expect(entry.glucose).toBe(154);
    expect(entry.raw).toBe(154);
    expect(entry.noise).toBe(2);
  });

});
