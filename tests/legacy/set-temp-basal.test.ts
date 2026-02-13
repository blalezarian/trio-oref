import { describe, it, expect } from 'vitest';
import { tempBasalFunctions } from '../../src/set-temp-basal/index';

describe('tempBasalFunctions.setTempBasal', () => {

    //function tempBasalFunctions.setTempBasal(rate, duration, profile, requestedTemp)

    const profile = { "current_basal": 0.8, "max_daily_basal": 1.3, "max_basal": 3.0 } as Record<string, unknown>;
    const rt = {};
    it('should cancel temp', () => {
        const requestedTemp = tempBasalFunctions.setTempBasal(0, 0, profile, rt);
        expect(requestedTemp.rate).toBe(0);
        expect(requestedTemp.duration).toBe(0);
    });

    it('should set zero temp', () => {
        const requestedTemp = tempBasalFunctions.setTempBasal(0, 30, profile, rt);
        expect(requestedTemp.rate).toBe(0);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should set high temp', () => {
        const requestedTemp = tempBasalFunctions.setTempBasal(2, 30, profile, rt);
        expect(requestedTemp.rate).toBe(2);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should not set basal on skip neutral mode', () => {
        profile.skip_neutral_temps = true;
        const rt2 = {};
        const current = { duration: 10 };
        let requestedTemp = tempBasalFunctions.setTempBasal(0.8, 30, profile, rt2, current);
        expect(requestedTemp.duration).toBe(0);
        requestedTemp = tempBasalFunctions.setTempBasal(0.8, 30, profile, {});
        expect(requestedTemp.reason).toBe('Suggested rate is same as profile rate, no temp basal is active, doing nothing');
    });

    it('should limit high temp to max_basal', () => {
        const requestedTemp = tempBasalFunctions.setTempBasal(4, 30, profile, rt);
        expect(requestedTemp.rate).toBe(3);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should limit high temp to 3 * max_daily_basal', () => {
        const profile = { "current_basal": 1.0, "max_daily_basal": 1.3, "max_basal": 10.0 };
        const requestedTemp = tempBasalFunctions.setTempBasal(6, 30, profile, rt);
        expect(requestedTemp.rate).toBe(3.9);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should limit high temp to 4 * current_basal', () => {
        const profile = { "current_basal": 0.7, "max_daily_basal": 1.3, "max_basal": 10.0 };
        const requestedTemp = tempBasalFunctions.setTempBasal(6, 30, profile, rt);
        expect(requestedTemp.rate).toBe(2.8);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should temp to 0 when requested rate is less then 0 * current_basal', () => {
        const profile = { "current_basal": 0.7, "max_daily_basal": 1.3, "max_basal": 10.0 };
        const requestedTemp = tempBasalFunctions.setTempBasal(-1, 30, profile, rt);
        expect(requestedTemp.rate).toBe(0);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should limit high temp to 4 * max_daily_basal when overridden', () => {
        const profile = { "current_basal": 2.0, "max_daily_basal": 1.3, "max_basal": 10.0, "max_daily_safety_multiplier": 4 };
        const requestedTemp = tempBasalFunctions.setTempBasal(6, 30, profile, rt);
        expect(requestedTemp.rate).toBe(5.2);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should limit high temp to 5 * current_basal when overridden', () => {
        const profile = { "current_basal": 0.7, "max_daily_basal": 1.3, "max_basal": 10.0, "current_basal_safety_multiplier": 5 };
        const requestedTemp = tempBasalFunctions.setTempBasal(6, 30, profile, rt);
        expect(requestedTemp.rate).toBe(3.5);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should allow small basal change when current temp is also small', () => {
        const rt = {};
        const profile = { "current_basal": 0.075, "max_daily_basal": 1.3, "max_basal": 10.0, "current_basal_safety_multiplier": 5, "model": "523" };
        const currentTemp = { "rate": 0.025, "duration": 24 };
        const requestedTemp = tempBasalFunctions.setTempBasal(0, 30, profile, rt, currentTemp);
        expect(requestedTemp.rate).toBe(0);
        expect(requestedTemp.duration).toBe(30);
    });

    it('should not allow small basal change when current temp is large', () => {
        const rt = {};
        const profile = { "current_basal": 10.075, "max_daily_basal": 11.3, "max_basal": 50.0, "current_basal_safety_multiplier": 5, "model": "523" };
        const currentTemp = { "rate": 10.1, "duration": 24 };
        tempBasalFunctions.setTempBasal(10.125, 30, profile, rt, currentTemp);
        //requestedTemp.reason.should.equal("undefined, but 24m left and 10.1 ~ req 10.1U/hr: no action required");
    });
});
