import { describe, it, expect } from 'vitest';

import { getLastGlucose } from '../../src/glucose/index';

describe('getLastGlucose', () => {
    it('should handle NS sgv fields', () => {
      const glucoseStatus = getLastGlucose([{date: 1467942845000, sgv: 100}, {date: 1467942544500, sgv: 95}, {date: 1467942244000, sgv: 85}, {date: 1467941944000, sgv: 70}] as any);
      //console.log(glucoseStatus);
      expect(glucoseStatus.delta).toBe(5);
      expect(glucoseStatus.glucose).toBe(100);
      expect(glucoseStatus.short_avgdelta).toBe(7.5);
      expect(glucoseStatus.long_avgdelta).toBe(0);
    });
    it('should handle two receivers 30s and 3 mg/dL offset', () => {
      const glucoseStatus = getLastGlucose([{date: 1467942875000, sgv: 103}, {date: 1467942845000, sgv: 100}, {date: 1467942574500, sgv: 98}, {date: 1467942544500, sgv: 95}, {date: 1467942274000, sgv: 88}, {date: 1467942244000, sgv: 85}, {date: 1467941974000, sgv: 73}, {date: 1467941944000, sgv: 70}] as any);
      //console.log(glucoseStatus);
      expect(glucoseStatus.delta).toBe(5);
      expect(glucoseStatus.glucose).toBe(101.5);
      expect(glucoseStatus.short_avgdelta).toBe(7.5);
      expect(glucoseStatus.long_avgdelta).toBe(0);
    });
    it('should handle fields named glucose and calculate long_avgdelta', () => {
      const glucoseStatus = getLastGlucose([{"date": 1469509700000, "glucose": 97}, {"date": 1469509400000, "glucose": 94}, {"date": 1469509100000, "glucose": 87}, {"date": 1469508800000, "glucose": 81}, {"date": 1469508500000, "glucose": 78}, {"date": 1469508200000, "glucose": 78}, {"date": 1469507900000, "glucose": 81}, {"date": 1469507600000, "glucose": 84}, {"date": 1469507300000, "glucose": 87}, {"date": 1469507000000, "glucose": 93}, {"date": 1469506700000, "glucose": 102}, {"date": 1469506400000, "glucose": 104}, {"date": 1469506100000, "glucose": 99}, {"date": 1469505800000, "glucose": 81}, {"date": 1469505500000, "glucose": 76}, {date: 1469509700000, glucose: 97}] as any);
      //console.log(glucoseStatus);
      expect(glucoseStatus.delta).toBe(3);
      expect(glucoseStatus.glucose).toBe(97);
      expect(glucoseStatus.short_avgdelta).toBe(4.44);
      expect(glucoseStatus.long_avgdelta).toBe(2.86);
    });
    it('should fall back to dateString property', () => {
      const glucoseStatus = getLastGlucose([{dateString: "2019-12-04T08:54:19.288-0800", sgv: 100}, {date: 1467942544500, sgv: 95}, {date: 1467942244000, sgv: 85}, {date: 1467941944000, sgv: 70}] as any);
      expect(glucoseStatus.date).toBe(1575478459288);
    });
    it('should skip meter BG', () => {
      const glucoseStatus = getLastGlucose([{date: 1467942845000, glucose: null, mbg: 100}, {date: 1467942544500, sgv: 95}, {date: 1467942244000, sgv: 85}, {date: 1467941944000, sgv: 70}] as any);
      //console.log(glucoseStatus);
      expect(glucoseStatus.delta).toBe(10);
      expect(glucoseStatus.glucose).toBe(95);
      expect(glucoseStatus.short_avgdelta).toBe(11.25);
      expect(glucoseStatus.long_avgdelta).toBe(0);
    });
});
