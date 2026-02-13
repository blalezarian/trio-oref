import { describe, it, expect } from 'vitest';
import { getMaxDailyBasalRate, getCurrentBasalRate } from '../../src/profile/basal';
import type { BasalScheduleEntry, BasalInputs } from '../../src/profile/basal';

describe('Basal', () => {

  const basalprofile: BasalScheduleEntry[] = [
    { i: 0, start: '00:00:00', rate: 0, minutes: 0 },
    { i: 1, start: '00:15:00', rate: 2, minutes: 15 },
    { i: 1, start: '00:45:00', rate: 0.5, minutes: 45 },
  ] as BasalScheduleEntry[];

  it('should find the right max daily basal', () => {

    const inputs = { basals: basalprofile } as BasalInputs;
    const maxBasal = getMaxDailyBasalRate(inputs);
    expect(maxBasal).toBe(2);

  });


  it('should find the right basal for a given timestamp', () => {

    const startingPoint = new Date('2016-06-13T00:20:00.000');
    const startingPoint2 = new Date('2016-06-13T01:00:00.000');
    let b = getCurrentBasalRate(basalprofile, startingPoint);
    expect(b).toBe(2);
    b = getCurrentBasalRate(basalprofile, startingPoint2);
    expect(b).toBe(0.5);

  });

});
