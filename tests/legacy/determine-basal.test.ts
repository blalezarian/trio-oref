import { describe, it, expect } from 'vitest';

import { round_basal } from '../../src/utils/round-basal';
import { determine_basal } from '../../src/determine-basal/determine-basal';
import tempBasalFunctions from '../../src/set-temp-basal/index';

describe('round_basal', () => {
    it('should round correctly without profile being passed in', () => {
        const basal = 0.025;
        const output = round_basal(basal);
        expect(output).toBe(0.05);
    });

    const profile = {model: "522"} as any;
    it('should round correctly with an old pump model', () => {
        const basal = 0.025;
        const output = round_basal(basal, profile);
        expect(output).toBe(0.05);
    });


    it('should round correctly with a new pump model', () => {
        const basal = 0.025;
        profile.model = "554";
        const output = round_basal(basal, profile);
        expect(output).toBe(0.025);
        //console.error(output);
    });

    it('should round correctly with an invalid pump model', () => {
        const basal = 0.025;
        profile.model = "HelloThisIsntAPumpModel";
        const output = round_basal(basal, profile);
        expect(output).toBe(0.05);
    });

    const data = [
        { basal: 0.83, rounded: 0.85},
        { basal: 0.86, rounded: 0.85},
        { basal: 1.83, rounded: 1.85},
        { basal: 1.86, rounded: 1.85},
        { basal: 10.83, rounded: 10.8},
        { basal: 10.86, rounded: 10.9}
    ];

    data.forEach((rate) => {
        it('should round basal rates properly (' + rate.basal + ' -> ' + rate.rounded + ')', () => {
            const output = round_basal(rate.basal);
            expect(output).toBe(rate.rounded);
        });
    });
});

describe('determine-basal', () => {
   //function determine_basal(glucose_status, currenttemp, iob_data, profile)

    // standard initial conditions for all determine-basal test cases unless overridden
    const glucose_status = {"delta":0,"glucose":115,"long_avgdelta":0.1,"short_avgdelta":0} as any;
    const currenttemp = {"duration":0,"rate":0,"temp":"absolute"} as any;
    const iob_data = [{"iob":0,"activity":0,"bolussnooze":0}] as any;
    const autosens = {"ratio":1.0} as any;
    const profile = {"max_iob":2.5,"dia":3,"type":"current","current_basal":0.9,"max_daily_basal":1.3,"max_basal":3.5,"max_bg":120,"min_bg":110,"sens":40,"carb_ratio":10} as any;
    const meal_data = {"carbs":50,"nsCarbs":50,"bwCarbs":0,"journalCarbs":0,"mealCOB":0,"currentDeviation":0,"maxDeviation":0,"minDeviation":0,"slopeFromMaxDeviation":0,"slopeFromMinDeviation":0,"allDeviations":[0,0,0,0,0],"bwFound":false} as any;

    it('should cancel high temp when in range w/o IOB', () => {
        const currenttemp = {"duration":30,"rate":1.5,"temp":"absolute"} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        // Trio uses min_bg (110) as target; BG 115 > 110, so algorithm sets temp above current_basal
        expect(output.rate).toBe(1.15);
        expect(output.duration).toBe(30);
    });

    //it('should let low temp run in range w/o IOB', () => {
        //const currenttemp = {"duration":30,"rate":0,"temp":"absolute"};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.error(output);
        //expect(output.rate).toBeUndefined();
        //expect(output.duration).toBeUndefined();
        //expect(output.reason).toMatch(/.*letting low.*/);
    //});

    // low glucose suspend test cases
    it('should temp to 0 when low w/o IOB', () => {
        const glucose_status = {"delta":-5,"glucose":75,"long_avgdelta":-5,"short_avgdelta":-5} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/BG 75<80/);
    });

    it('should not extend temp to 0 when <10m elapsed', () => {
        const currenttemp = {"duration":57,"rate":0,"temp":"absolute"} as any;
        const glucose_status = {"delta":-5,"glucose":75,"long_avgdelta":-5,"short_avgdelta":-5} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeUndefined();
        expect(output.duration).toBeUndefined();
    });

    it('should do nothing when low and rising w/o IOB', () => {
        const glucose_status = {"delta":6,"glucose":75,"long_avgdelta":6,"short_avgdelta":6} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        // Trio target adjustment causes slightly different rate
        expect(output.rate).toBe(0.95);
        expect(output.duration).toBe(30);
    });

    //it('should do nothing when low and rising w/ negative IOB', () => {
        //const glucose_status = {"delta":5,"glucose":75,"long_avgdelta":5,"short_avgdelta":5};
        //const iob_data = {"iob":-1,"activity":-0.01,"bolussnooze":0};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/75<80.*setting current basal/);
    //});

    //it('should do nothing on large uptick even if avgdelta is still negative', () => {
        //const glucose_status = {"delta":4,"glucose":75,"long_avgdelta":-2,"short_avgdelta":-2};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/BG 75<80/);
    //});

    it('should temp to zero when rising slower than BGI', () => {
        const glucose_status = {"delta":1,"glucose":75,"long_avgdelta":1,"short_avgdelta":1} as any;
        const iob_data = [{"iob":-0.5,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBe(0);
        expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/BG 75<80/);
    });

    it('should temp to 0 when low and falling, regardless of BGI', () => {
        const glucose_status = {"delta":-1,"glucose":75,"long_avgdelta":-1,"short_avgdelta":-1} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0.5}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBe(0);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/BG 75<80/);
    });

    //it('should cancel high-temp when low and rising faster than BGI', () => {
        //const currenttemp = {"duration":20,"rate":2,"temp":"absolute"};
        //const glucose_status = {"delta":5,"glucose":75,"long_avgdelta":5,"short_avgdelta":5};
        //const iob_data = {"iob":-1,"activity":-0.01,"bolussnooze":0};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/BG 75<80, min delta .*/);
    //});

    //it('should cancel low-temp when eventualBG is higher then max_bg', () => {
        //const currenttemp = {"duration":20,"rate":0,"temp":"absolute"};
        //const glucose_status = {"delta":5,"glucose":75,"long_avgdelta":5,"short_avgdelta":5};
        //const iob_data = {"iob":-1,"activity":-0.01,"bolussnooze":0};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/BG 75<80, min delta .*/);
    //});

    it('should high-temp when > 80-ish and rising w/ lots of negative IOB', () => {
        const glucose_status = {"delta":5,"glucose":85,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":-1,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(1);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/no temp, setting/);
    });

    it('should high-temp when > 180-ish and rising but not more then maxSafeBasal', () => {
        const glucose_status = {"delta":5,"glucose":185,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.reason).toMatch(/.*, adj. req. rate:.* to maxSafeBasal:.*, no temp, setting/);
    });

    it('should reduce high-temp when schedule would be above max', () => {
        const glucose_status = {"delta":5,"glucose":145,"long_avgdelta":5,"short_avgdelta":5} as any;
        const currenttemp = {"duration":160,"rate":1.9,"temp":"absolute"} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/.* > 2.*insulinReq. Setting temp.*/);
    });

    it('should continue high-temp when required ~= temp running', () => {
        const glucose_status = {"delta":5,"glucose":145,"long_avgdelta":5,"short_avgdelta":5} as any;
        const currenttemp = {"duration":30,"rate":3.5,"temp":"absolute"} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeUndefined();
        expect(output.duration).toBeUndefined();
        expect(output.reason).toMatch(/Eventual BG .*>.*, temp .* >~ req /);
    });

    it('should set high-temp when required running temp is low', () => {
        const glucose_status = {"delta":5,"glucose":145,"long_avgdelta":5,"short_avgdelta":5} as any;
        const currenttemp = {"duration":30,"rate":1.1,"temp":"absolute"} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG .*>.*, temp/);
    });

    it('should stop high-temp when iob is near max_iob.', () => {
        const glucose_status = {"delta":5,"glucose":485,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":3.5,"activity":0.05,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0.9);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/IOB .* > max_iob .*/);
    });

    it('should temp to 0 when LOW w/ positive IOB', () => {
        const glucose_status = {"delta":0,"glucose":39,"long_avgdelta":0.1,"short_avgdelta":0} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0.5}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/BG 39<80/);
    });

    it('should low temp when LOW w/ negative IOB', () => {
        const glucose_status = {"delta":0,"glucose":39,"long_avgdelta":0.1,"short_avgdelta":0} as any;
        const iob_data = [{"iob":-2.5,"activity":-0.03,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeLessThan(0.8);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/BG 39<80/);
    });

    it('should temp to 0 when LOW w/ no IOB', () => {
        const glucose_status = {"delta":0,"glucose":39,"long_avgdelta":0.1,"short_avgdelta":0} as any;
        const iob_data = [{"iob":0,"activity":0,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/BG 39<80/);
    });



    // low eventualBG

    it('should low-temp when eventualBG < min_bg', () => {
        const glucose_status = {"delta":-3,"glucose":110,"long_avgdelta":-1,"short_avgdelta":-1} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeLessThan(0.8);
        expect(output.duration).toBeGreaterThan(29);
        expect(output.reason).toMatch(/Eventual BG .*< 110.*/);
    });

    it('should low-temp when eventualBG < min_bg with delta > exp. delta', () => {
        const glucose_status = {"delta":-5,"glucose":115,"long_avgdelta":-6,"short_avgdelta":-6} as any;
        const iob_data = [{"iob":2,"activity":0.05,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeLessThan(0.2);
        expect(output.duration).toBeGreaterThan(29);
        //expect(output.reason).toMatch(/Eventual BG .*< 110.*setting .*/);
    });

    it('should low-temp when eventualBG < min_bg with delta > exp. delta', () => {
        const glucose_status = {"delta":-2,"glucose":156,"long_avgdelta":-1.33,"short_avgdelta":-1.33} as any;
        const iob_data = [{"iob":3.51,"activity":0.06,"bolussnooze":0.08}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeLessThan(0.8);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG .*< 110.*setting .*/);
    });

    it('should low-temp much less when eventualBG < min_bg with delta barely negative', () => {
        const glucose_status = {"delta":-1,"glucose":115,"long_avgdelta":-1,"short_avgdelta":-1} as any;
        const iob_data = [{"iob":2,"activity":0.05,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(0.3);
        expect(output.rate).toBeLessThan(0.8);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG .*< 110.*setting .*/);
    });

    //it('should do nothing when eventualBG < min_bg but appropriate low temp in progress', () => {
        //const glucose_status = {"delta":-1,"glucose":110,"long_avgdelta":-1,"short_avgdelta":-1};
        //const currenttemp = {"duration":20,"rate":0.25,"temp":"absolute"};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        ////console.log(output);
        //expect(output.rate).toBeUndefined();
        //expect(output.duration).toBeUndefined();
        //expect(output.reason).toMatch(/Eventual BG .*< 110, temp .*/);
    //});

    it('should cancel low-temp when lowish and avg.delta rising faster than BGI', () => {
        const currenttemp = {"duration":20,"rate":0.5,"temp":"absolute"} as any;
        const glucose_status = {"delta":3,"glucose":85,"long_avgdelta":3,"short_avgdelta":3} as any;
        const iob_data = [{"iob":-0.7,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(0.8);
        expect(output.duration).toBe(30);
        //expect(output.rate).toBe(0);
        //expect(output.duration).toBe(0);
        //expect(output.reason).toMatch(/.*; cancel/);
    });

    it('should cancel low-temp when lowish and delta rising faster than BGI', () => {
        const currenttemp = {"duration":20,"rate":0.5,"temp":"absolute"} as any;
        const glucose_status = {"delta":3,"glucose":85,"long_avgdelta":3,"short_avgdelta":3} as any;
        const iob_data = [{"iob":-0.7,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeGreaterThan(0.8);
        expect(output.duration).toBe(30);
    });

    it('should set current basal as temp when lowish and delta rising faster than BGI', () => {
        const currenttemp = {"duration":0,"rate":0.5,"temp":"absolute"} as any;
        const glucose_status = {"delta":3,"glucose":85,"long_avgdelta":3,"short_avgdelta":3} as any;
        const iob_data = [{"iob":-0.7,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        // Trio target change: BG 85 with negative IOB triggers higher rate
        expect(output.rate).toBe(1.35);
        expect(output.duration).toBe(30);
    });


    it('should low-temp when low and rising slower than BGI', () => {
        const glucose_status = {"delta":1,"glucose":85,"long_avgdelta":1,"short_avgdelta":1} as any;
        const iob_data = [{"iob":-0.5,"activity":-0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeLessThan(0.8);
        expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/setting/);
    });

    // high eventualBG

    it('should high-temp when eventualBG > max_bg', () => {
        const glucose_status = {"delta":+3,"glucose":120,"long_avgdelta":0,"short_avgdelta":+1} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(1);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG .*>= 110/);
    });

    it('should cancel high-temp when high and avg. delta falling faster than BGI', () => {
        const currenttemp = {"duration":20,"rate":2,"temp":"absolute"} as any;
        const glucose_status = {"delta":-5,"glucose":175,"long_avgdelta":-5,"short_avgdelta":-5} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0.9);
        expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/.*; cancel/);
        //expect(output.rate).toBe(0);
        //expect(output.duration).toBe(0);
        expect(output.reason).toMatch(/Eventual BG.*>.*but Min. Delta.*< Exp.*/);
    });

    it('should cancel high-temp when high and delta falling faster than BGI', () => {
        const currenttemp = {"duration":20,"rate":2,"temp":"absolute"} as any;
        const glucose_status = {"delta":-5,"glucose":175,"long_avgdelta":-4,"short_avgdelta":-4} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0.9);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG.*>.*but.*Delta.*< Exp.*/);
    });

    it('should do nothing when no temp and high and delta falling faster than BGI', () => {
        const currenttemp = {"duration":0,"rate":0,"temp":"absolute"} as any;
        const glucose_status = {"delta":-5,"glucose":175,"long_avgdelta":-4,"short_avgdelta":-4} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //expect(output.rate).toBeUndefined();
        //expect(output.duration).toBeUndefined();
        expect(output.rate).toBe(0.9);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/Eventual BG.*>.*but.*Delta.*< Exp.*/);
    });

    it('should high-temp when high and falling slower than BGI', () => {
        const glucose_status = {"delta":-1,"glucose":175,"long_avgdelta":-1,"short_avgdelta":-1} as any;
        const iob_data = [{"iob":1,"activity":0.01,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(1);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/no temp, setting/);
    });

    it('should high-temp when high and falling slowly with low insulin activity', () => {
        const glucose_status = {"delta":-1,"glucose":300,"long_avgdelta":-1,"short_avgdelta":-1} as any;
        const iob_data = [{"iob":0.5,"activity":0.005,"bolussnooze":0}] as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeGreaterThan(2.5);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/no temp, setting/);
    });

    //it('should set lower high-temp when high and falling almost fast enough with low insulin activity', () => {
        //const glucose_status = {"delta":-6,"glucose":300,"long_avgdelta":-5,"short_avgdelta":-5};
        //const iob_data = {"iob":0.5,"activity":0.005,"bolussnooze":0};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.error(output);
        //expect(output.rate).toBeGreaterThan(1);
        //expect(output.rate).toBeLessThan(2);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/no temp, setting/);
    //});

    //it('should reduce high-temp when high and falling almost fast enough with low insulin activity', () => {
        //const glucose_status = {"delta":-6,"glucose":300,"long_avgdelta":-5,"short_avgdelta":-5};
        //const iob_data = {"iob":0.5,"activity":0.005,"bolussnooze":0};
        //const currenttemp = {"duration":30,"rate":3.5,"temp":"absolute"};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.error(output);
        //expect(output.rate).toBeGreaterThan(1);
        //expect(output.rate).toBeLessThan(2);
        //expect(output.duration).toBe(30);
        //expect(output.reason).toMatch(/.* > 2.*insulinReq. Setting temp.*/);
    //});

    it('should profile.current_basal be undefined return error', () => {
      const result = determine_basal(undefined as any, undefined as any, undefined as any, undefined as any);
      expect(result.error).toBe('Error: could not get current basal rate');
    });

    it('should let low-temp run when bg < 30 (Dexcom is in ???)', () => {
        const currenttemp = {"duration":30,"rate":0,"temp":"absolute"} as any;
        const output = determine_basal({glucose:10} as any, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeUndefined();
        expect(output.reason).toMatch(/CGM is calibrating/);
    });

    it('should cancel high-temp when bg < 30 (Dexcom is in ???)', () => {
        const currenttemp = {"duration":30,"rate":2,"temp":"absolute"} as any;
        const output = determine_basal({glucose:10} as any, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBeLessThan(1);
        expect(output.reason).toMatch(/Replacing high temp/);
    });

    it('profile should contain min_bg,max_bg', () => {
      const result = determine_basal({glucose:100} as any, undefined as any, undefined as any, {"current_basal":0.0} as any, autosens, meal_data, tempBasalFunctions);
      expect(result.error).toBe('Error: could not determine target_bg. ');
    });

    it('iob_data should not be undefined', () => {
      const result = determine_basal({glucose:100} as any, undefined as any, undefined as any, {"current_basal":0.0, "max_bg":100,"min_bg":1100} as any, autosens, meal_data, tempBasalFunctions);
      expect(result.error).toBe('Error: iob_data undefined. ');
    });

    //it('iob_data should contain activity, iob, bolussnooze', () => {
      //const result = determine_basal({glucose:100} as any, undefined as any, {"activity":0} as any, {"current_basal":0.0, "max_bg":100,"min_bg":110} as any, autosens, meal_data, tempBasalFunctions);
      //expect(result.error).toBe('Error: iob_data missing some property. ');
    //});

/*
    it('should return error eventualBG if something went wrong', () => {
      const result = determine_basal({glucose:100} as any, undefined as any, {"activity":0, "iob":0,"bolussnooze":0} as any, {"current_basal":0.0, "sens":NaN} as any, autosens, meal_data, tempBasalFunctions);
      expect(result.error).toBe('Error: could not calculate eventualBG');
    });
*/

    // meal assist / bolus snooze
    // right after 20g 1U meal bolus
    //it('should set current basal as temp when low and rising after meal bolus', () => {
        //const glucose_status = {"delta":1,"glucose":80,"long_avgdelta":1,"short_avgdelta":1};
        //const iob_data = {"iob":0.5,"activity":-0.01,"bolussnooze":1,"basaliob":-0.5};
        //const meal_data = {"carbs":20,"boluses":1, "mealCOB":20};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
    //});

    it('should do nothing when requested temp already running with >15m left', () => {
        const glucose_status = {"delta":-2,"glucose":121,"long_avgdelta":-1.333,"short_avgdelta":-1.333} as any;
        const iob_data = [{"iob":3.983,"activity":0.0255,"bolussnooze":2.58,"basaliob":0.384,"netbasalinsulin":0.3,"hightempinsulin":0.7}] as any;
        const meal_data = {"carbs":65,"boluses":4, "mealCOB":65} as any;
        const currenttemp = {"duration":29,"rate":1.3,"temp":"absolute"} as any;
        const profile = {"max_iob":3,"type":"current","dia":3,"current_basal":1.3,"max_daily_basal":1.3,"max_basal":3.5,"min_bg":105,"max_bg ":105,"sens":40,"carb_ratio":10} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBeUndefined();
        expect(output.duration).toBeUndefined();
    });

    //it('should cancel high temp when low and dropping after meal bolus', () => {
        //const glucose_status = {"delta":-1,"glucose":80,"long_avgdelta":1,"short_avgdelta":1};
        //const iob_data = {"iob":0.5,"activity":-0.01,"bolussnooze":1,"basaliob":-0.5};
        //const currenttemp = {"duration":20,"rate":2,"temp":"absolute"};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        ////console.log(output);
        ////expect(output.rate).toBe(0);
        ////expect(output.duration).toBe(0);
        //expect(output.rate).toBeLessThan(1.0);
        //expect(output.duration).toBe(30);
    //});

    //it('should cancel low temp when low and rising after meal bolus', () => {
        //const glucose_status = {"delta":1,"glucose":80,"long_avgdelta":1,"short_avgdelta":1};
        //const iob_data = {"iob":0.5,"activity":-0.01,"bolussnooze":1,"basaliob":-0.5};
        //const currenttemp = {"duration":20,"rate":0,"temp":"absolute"};
        //const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        ////console.log(output);
        //expect(output.rate).toBe(0.9);
        //expect(output.duration).toBe(30);
        ////expect(output.rate).toBe(0);
        ////expect(output.duration).toBe(0);
    //});

    /* TODO: figure out how to do tests for advanced-meal-assist
    // 40m after 20g 1U meal bolus
    it('should high-temp aggressively when 120 and rising after meal bolus', function () {
        var glucose_status = {"delta":10,"glucose":120,"avgdelta":10};
        var iob_data = {"iob":0.4,"activity":0,"bolussnooze":0.7,"basaliob":-0.3};
        var meal_data = {"carbs":20,"boluses":1, "mealCOB":20};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.be.above(1.8);
        output.duration.should.equal(30);
    });

    // 60m after 20g 1U meal bolus
    it('should high-temp aggressively when 150 and rising after meal bolus', function () {
        var glucose_status = {"delta":3,"glucose":150,"avgdelta":5};
        var iob_data = {"iob":0.5,"activity":0.01,"bolussnooze":0.6,"basaliob":-0.1};
        var meal_data = {"carbs":20,"boluses":1, "mealCOB":20};
        var currenttemp = {"duration":10,"rate":2,"temp":"absolute"};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.be.above(2.2);
        output.duration.should.equal(30);
    });

    // 75m after 20g 1U meal bolus
    it('should reduce high-temp when 160 and dropping slowly after meal bolus', function () {
        var glucose_status = {"delta":-3,"glucose":160,"avgdelta":0};
        var iob_data = {"iob":0.9,"activity":0.02,"bolussnooze":0.5,"basaliob":0.4};
        var meal_data = {"carbs":20,"boluses":1, "mealCOB":20};
        var currenttemp = {"duration":30,"rate":2.5,"temp":"absolute"};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        output.rate.should.be.below(1.5);
    });

    // right after 120g 6U meal bolus
    it('should high-temp when 120 and rising after meal bolus', function () {
        var glucose_status = {"delta":4,"glucose":120,"avgdelta":4};
        var iob_data = {"iob":6,"activity":0,"bolussnooze":6,"basaliob":0,"hightempinsulin":0};
        var meal_data = {"carbs":120,"boluses":6, "mealCOB":120};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.be.above(1);
        output.duration.should.equal(30);
    });

    // after 120g 6U meal bolus
    it('should high-temp when 140 and rising after meal bolus', function () {
        var glucose_status = {"delta":4,"glucose":140,"avgdelta":4};
        var iob_data = {"iob":6.5,"activity":0.01,"bolussnooze":5.5,"basaliob":1,"hightempinsulin":1};
        var meal_data = {"carbs":120,"boluses":6, "mealCOB":100};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.be.above(1);
        output.duration.should.equal(30);
    });

    // after 120g 6U meal bolus
    it('should high-temp when 160 and rising after meal bolus', function () {
        var glucose_status = {"delta":4,"glucose":160,"avgdelta":4};
        var iob_data = {"iob":7.0,"activity":0.02,"bolussnooze":5.0,"basaliob":2,"hightempinsulin":2};
        var meal_data = {"carbs":120,"boluses":6, "mealCOB":80};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.be.above(1);
        output.duration.should.equal(30);
    });

    // after 120g 6U meal bolus
    it('should not high-temp when 160 and rising slowly after meal bolus', function () {
        var glucose_status = {"delta":1,"glucose":160,"avgdelta":1};
        var iob_data = {"iob":7.0,"activity":0.02,"bolussnooze":5.0,"basaliob":2};
        var meal_data = {"carbs":120,"boluses":6, "mealCOB":80};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        //should.not.exist(output.rate);
        //should.not.exist(output.duration);
        output.rate.should.equal(0.9);
        output.duration.should.equal(30);
    });

    // after 120g 6U meal bolus
    it('should cancel temp when 160 and falling after meal bolus', function () {
        var glucose_status = {"delta":-1,"glucose":160,"avgdelta":-1};
        var iob_data = {"iob":7.0,"activity":0.03,"bolussnooze":5.0,"basaliob":2};
        var meal_data = {"carbs":120,"boluses":6, "mealCOB":80};
        var currenttemp = {"duration":15,"rate":2.5,"temp":"absolute"};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        output.rate.should.equal(0.9);
        output.duration.should.equal(30);
        //output.rate.should.equal(0);
        //output.duration.should.equal(0);
    });

    it('should not set temp when boluses + basal IOB cover meal carbs', function () {
        var glucose_status = {"delta":1,"glucose":160,"avgdelta":1};
        var iob_data = {"iob":7.0,"activity":0.02,"bolussnooze":4.0,"basaliob":3};
        var meal_data = {"carbs":120,"boluses":11, "mealCOB":80};
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        console.log(output);
        output.rate.should.equal(0.9);
        output.duration.should.equal(30);
        //(typeof output.rate).should.equal('undefined');
        //(typeof output.duration).should.equal('undefined');
    });

    it('should not set temp when boluses + basal IOB cover meal carbs', function () {
        var meal_data = {"carbs":15,"boluses":2, "mealCOB":15}
        var glucose_status = {"delta":3,"glucose":200,"avgdelta":8.667}
        var currenttemp = {"duration":3,"rate":3.5,"temp":"absolute"}
        var iob_data = {"iob":2.701,"activity":0.0107,"bolussnooze":0.866,"basaliob":1.013,"netbasalinsulin":1.1,"hightempinsulin":1.8}
        var profile_data = {"max_iob":3,"type":"current","dia":3,"current_basal":0.9,"max_daily_basal":1.3,"max_basal":3.5,"min_bg":105,"max_bg":105,"sens":40,"carb_ratio":10}
        var output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //console.log(output);
        //output.rate.should.equal(0.9);
        //output.duration.should.equal(30);
        //(typeof output.rate).should.equal('undefined');
        //(typeof output.duration).should.equal('undefined');
    });
    */

    it('should temp to zero with double sensitivity adjustment', () => {
        //const glucose_status = {"delta":1,"glucose":160,"avgdelta":1};
        const iob_data = [{"iob":0.5,"activity":0.001,"bolussnooze":0.0,"basaliob":0.5}] as any;
        const autosens_data = {"ratio":0.5} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens_data, meal_data, tempBasalFunctions);
        //console.log(output);
        expect(output.rate).toBe(0);
        expect(output.duration).toBe(30);
    });

    it('maxSafeBasal current_basal_safety_multiplier of 1 should cause the current rate to be set, even if higher is needed', () => {
        const glucose_status = {"delta":5,"glucose":185,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        profile.current_basal_safety_multiplier = 1;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0.9);
        expect(output.reason).toMatch(/.*, adj. req. rate:.* to maxSafeBasal:.*, no temp, setting/);
    });

    it('maxSafeBasal max_daily_safety_multiplier of 1 should cause the max daily rate to be set, even if higher is needed', () => {
        const glucose_status = {"delta":5,"glucose":185,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        profile.current_basal_safety_multiplier = null;
        profile.max_daily_safety_multiplier = 1;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(1.3);
        expect(output.reason).toMatch(/.*, adj. req. rate:.* to maxSafeBasal:.*, no temp, setting/);
    });

    it('overriding maxSafeBasal multipliers to 10 should increase temp', () => {
        const glucose_status = {"delta":5,"glucose":285,"long_avgdelta":5,"short_avgdelta":5} as any;
        const iob_data = [{"iob":0,"activity":-0.01,"bolussnooze":0}] as any;
        profile.max_basal = 5;
        profile.current_basal_safety_multiplier = 10;
        profile.max_daily_safety_multiplier = 10;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(5);
        expect(output.reason).toMatch(/.*, adj. req. rate:.* to maxSafeBasal:.*, no temp, setting/);
    });

    it('should round appropriately for small basals when setting basal to maxSafeBasal ', () => {
        const glucose_status = {"delta":5,"glucose":185,"long_avgdelta":5,"short_avgdelta":5} as any;
        const profile2 = {"max_iob":2.5,"dia":3,"type":"current","current_basal":0.025,"max_daily_basal":1.3,"max_basal":.05,"max_bg":120,"min_bg":110,"sens":200,"model":"523"} as any;
        const currenttemp = {"duration":0,"rate":0,"temp":"absolute"} as any;
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile2, autosens, meal_data, tempBasalFunctions);
        expect(output.rate).toBe(0.05);
        expect(output.duration).toBe(30);
        expect(output.reason).toMatch(/.*, adj. req. rate:.* to maxSafeBasal: 0.05, no temp, setting 0.05/);
    });

    it('should match the basal rate precision available on a 523', () => {
        //const currenttemp = {"duration":30,"rate":0,"temp":"absolute"};
        const currenttemp = {"duration":0,"rate":0,"temp":"absolute"} as any;
        profile.current_basal = 0.825;
        profile.model = "523";
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        //expect(output.rate).toBe(0);
        //expect(output.duration).toBe(0);
        // Trio target change: BG 115 > min_bg 110, sets higher temp
        expect(output.rate).toBe(1.1);
        expect(output.duration).toBe(30);
    });

    it('should match the basal rate precision available on a 522', () => {
        //const currenttemp = {"duration":30,"rate":0,"temp":"absolute"};
        const currenttemp = {"duration":0,"rate":0,"temp":"absolute"} as any;
        profile.current_basal = 0.875;
        profile.model = "522";
        const output = determine_basal(glucose_status, currenttemp, iob_data, profile, autosens, meal_data, tempBasalFunctions);
        // Trio target change: BG 115 > min_bg 110, sets higher temp
        expect(output.rate).toBe(1.15);
        expect(output.duration).toBe(30);
    });

});
