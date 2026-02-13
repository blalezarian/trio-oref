import { describe, it, expect } from 'vitest';

import { generate as iob } from '../../src/iob';

// Helper: subtract minutes from a Date and return a new Date
const subtractMinutes = (date: Date, mins: number): Date => {
    return new Date(date.getTime() - mins * 60 * 1000);
};

describe('IOB', () => {

    it('should calculate IOB', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 2,
                timestamp: timestamp
            }],
            profile: {
                dia: 3,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1
            }

        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(2);
        //rightAfterBolus.bolussnooze.should.equal(2);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(1.45);
        //hourLater.bolussnooze.should.be.lessThan(.5);
        expect(hourLater.iob).toBeGreaterThan(0);
        expect(hourLater.activity).toBeGreaterThan(0.01);
        expect(hourLater.activity).toBeLessThan(0.02);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (3 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Ultra-fast curve', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 2,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'ultra-rapid'
            }
        };

        const rightAfterBolus = iob(inputs)[0];

        expect(rightAfterBolus.iob).toBe(2);
        //rightAfterBolus.bolussnooze.should.equal(2);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(1.6);
        expect(hourLater.iob).toBeGreaterThan(1.3);

        //hourLater.bolussnooze.should.be.lessThan(1.7);
        expect(hourLater.iob).toBeGreaterThan(0);
        expect(hourLater.activity).toBeGreaterThan(0.006);
        expect(hourLater.activity).toBeLessThan(0.015);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];
        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Ultra-fast peak setting of 55', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                insulinPeakTime: 55,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'ultra-rapid'
            }
        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.75);
        //hourLater.bolussnooze.should.be.lessThan(0.75);
        expect(hourLater.iob).toBeGreaterThan(0);
        expect(hourLater.activity).toBeGreaterThan(0.0065);
        expect(hourLater.activity).toBeLessThan(0.008);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Ultra-fast curve peak setting of 65', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                insulinPeakTime: 65,
                useCustomPeakTime: true,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'ultra-rapid'
            }
        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.77);
        //hourLater.bolussnooze.should.be.lessThan(0.36);
        expect(hourLater.iob).toBeGreaterThan(0.72);
        //hourLater.bolussnooze.should.be.greaterThan(0.354);

        expect(hourLater.activity).toBeGreaterThan(0.0055);
        expect(hourLater.activity).toBeLessThan(0.007);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Ultra-rapid curve peak setting of 75', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                insulinPeakTime: 75,
                useCustomPeakTime: true,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'ultra-rapid'
            }
        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.81);
        //hourLater.bolussnooze.should.be.lessThan(0.5);
        expect(hourLater.iob).toBeGreaterThan(0.76);
        //hourLater.bolussnooze.should.be.greaterThan(0.40);

        expect(hourLater.iob).toBeGreaterThan(0);
        expect(hourLater.activity).toBeGreaterThan(0.0047);
        expect(hourLater.activity).toBeLessThan(0.007);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Ultra-rapid curve peak setting of 44 and DIA = 6', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 6,
                insulinPeakTime: 44,
                useCustomPeakTime: true,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'ultra-rapid'
            }
        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.59);
        //hourLater.bolussnooze.should.be.lessThan(0.23);

        expect(hourLater.iob).toBeGreaterThan(0.57);
        //hourLater.bolussnooze.should.be.greaterThan(0.21);

        expect(hourLater.activity).toBeGreaterThan(0.007);
        expect(hourLater.activity).toBeLessThan(0.0085);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (6 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should calculate IOB with Rapid-acting', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'rapid-acting'
            }
        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.8);
        //hourLater.bolussnooze.should.be.lessThan(.8);
        expect(hourLater.iob).toBeGreaterThan(0);

        const afterDIAInputs = inputs;
        afterDIAInputs.clock = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
        const afterDIA = iob(afterDIAInputs)[0];

        expect(afterDIA.iob).toBe(0);
        //afterDIA.bolussnooze.should.equal(0);
    });

    it('should force minimum 5 hour DIA with Rapid-acting', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 5,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1,
                curve: 'rapid-acting'
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (4 * 60 * 60 * 1000)).toISOString();

        const hourLaterWith5 = iob(hourLaterInputs)[0];

        console.error(hourLaterWith5.iob);

        hourLaterInputs.profile.dia = 3;

        const hourLaterWith4 = iob(hourLaterInputs)[0];

        console.error(hourLaterWith4.iob);

        expect(hourLaterWith4.iob).toBe(hourLaterWith5.iob);
    });

    //it('should snooze fast if bolussnooze_dia_divisor is high', function() {

        //var now = Date.now(),
            //timestamp = new Date(now).toISOString(),
            //inputs = {
                //clock: timestamp,
                //history: [{
                    //_type: 'Bolus',
                    //amount: 1,
                    //timestamp: timestamp
                //}],
                //profile: {
                    //dia: 3,
                    //bolussnooze_dia_divisor: 10
                //}
            //};

        //var snoozeInputs = inputs;
        //snoozeInputs.clock = new Date(now + (20 * 60 * 1000)).toISOString();
        //var snooze = iob(snoozeInputs)[0];
        //snooze.bolussnooze.should.equal(0);
    //});

    it('should calculate IOB with Temp Basals', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        const iobInputs = inputs;
        const iobNow = iob(iobInputs)[0];

        //console.log(iobNow);
        expect(iobNow.iob).toBeLessThan(1);
        expect(iobNow.iob).toBeGreaterThan(0.5);
    });

    it('should calculate IOB with Temp Basals and a basal profile', () => {

        const startingPoint = new Date('2016-06-13T01:00:00.000');
        const timestamp = startingPoint.toISOString();
        const timestampEarly = subtractMinutes(startingPoint, 30).toISOString();

        const basalprofile = [{
                'i': 0,
                'start': '00:00:00',
                'rate': 2,
                'minutes': 0
            },
            {
                'i': 1,
                'start': '01:00:00',
                'rate': 1,
                'minutes': 60
            }
        ];

        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp,
                timestamp: timestamp
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp,
                timestamp: timestamp,
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestampEarly,
                timestamp: timestampEarly,
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestampEarly,
                timestamp: timestampEarly
            }],
            profile: {
                dia: 3,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date('2016-06-13T01:30:00.000');
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(0.5);
        expect(hourLater.iob).toBeGreaterThan(0.4);
    });

    it('should calculate IOB with Temp Basals that overlap midnight and a basal profile', () => {

        const basalprofile = [{
                'i': 0,
                'start': '00:00:00',
                'rate': 2,
                'minutes': 0
            },
            {
                'i': 1,
                'start': '00:15:00',
                'rate': 1,
                'minutes': 15
            },
            {
                'i': 2,
                'start': '00:45:00',
                'rate': 0.5,
                'minutes': 45
            }
        ];

        const startingPoint = new Date('2016-06-13T00:15:00.000');
        const timestamp = startingPoint.toISOString();
        const timestampEarly = subtractMinutes(startingPoint, 30).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasal',
                rate: 2,
                date: timestamp,
                timestamp: timestamp
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp,
                timestamp: timestamp
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestampEarly,
                timestamp: timestampEarly
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestampEarly,
                timestamp: timestampEarly
            }],
            profile: {
                dia: 3,
                current_basal: 0.1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date('2016-06-13T00:45:00.000');
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBeLessThan(0.8);
        expect(hourLater.iob).toBeGreaterThan(0.7);
    });

    it('should calculate IOB with Temp Basals that overlap each other', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const startingPoint = new Date('2016-06-13T00:30:00.000');
        const timestamp = startingPoint;
        const timestampEarly = subtractMinutes(startingPoint, 30);

        const earlyUnix = Math.floor(timestampEarly.getTime() / 1000);
        const earlyISO = timestampEarly.toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: earlyUnix,
                timestamp: earlyISO
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: earlyUnix,
                timestamp: earlyISO
            }],
            profile: {
                dia: 3,
                current_basal: 0.1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        let hourLater = iob(inputs)[0];

        const timestampEarly2 = subtractMinutes(startingPoint, 29);
        const timestampEarly3 = subtractMinutes(startingPoint, 28);

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: earlyUnix,
                timestamp: earlyISO
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: earlyUnix,
                timestamp: earlyISO
            }],
            profile: {
                dia: 3,
                current_basal: 0.1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date('2016-06-13T00:30:00.000');
        hourLater = iob(hourLaterInputs)[0];

        const early2Unix = Math.floor(timestampEarly2.getTime() / 1000);
        const early2ISO = timestampEarly2.toISOString();
        const early3Unix = Math.floor(timestampEarly3.getTime() / 1000);
        const early3ISO = timestampEarly3.toISOString();

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: earlyUnix,
                timestamp: earlyISO
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: earlyUnix,
                timestamp: earlyISO
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: early2Unix,
                timestamp: early2ISO
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: early2Unix,
                timestamp: early2ISO
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: early3Unix,
                timestamp: early3ISO
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: early3Unix,
                timestamp: early3ISO
            }],
            profile: {
                dia: 3,
                current_basal: 0.1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        const hourLaterWithOverlap = iob(inputs)[0];

        expect(hourLater.iob).toBeGreaterThan(hourLaterWithOverlap.iob - 0.05);
        expect(hourLater.iob).toBeLessThan(hourLaterWithOverlap.iob + 0.05);
    });

    it('should calculate IOB with Temp Basals that overlap midnight and a basal profile, part deux', () => {

        const basalprofile = [{
                'i': 0,
                'start': '00:00:00',
                'rate': 2,
                'minutes': 0
            },
            {
                'i': 1,
                'start': '00:15:00',
                'rate': 0.1,
                'minutes': 15
            },
            {
                'i': 1,
                'start': '00:30:00',
                'rate': 2,
                'minutes': 30
            },
            {
                'i': 1,
                'start': '00:45:00',
                'rate': 0.1,
                'minutes': 45
            }
        ];

        const startingPoint = new Date('2016-06-13T23:45:00.000');
        const timestamp = startingPoint.toISOString();
        const timestampEarly = subtractMinutes(startingPoint, 30).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 60,
                date: timestamp,
                timestamp: timestamp
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp,
                timestamp: timestamp
            }],
            profile: {
                dia: 3,
                current_basal: 0.1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date('2016-06-14T00:45:00.000');
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBeLessThan(1);
        expect(hourLater.iob).toBeGreaterThan(0.8);
    });

    it('should calculate IOB without counting time pump suspended at end of basal', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 0,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs = inputs;

        // Calculate IOB with inputs that will be the same as
        const iobNowWithoutSuspend = iob(iobInputs)[0];

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'PumpSuspend',
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'PumpResume',
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        iobInputs = inputs;

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should calculate IOB without counting time pump suspended in middle of basal', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 0,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }],
            profile: {
                dia: 5,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs = inputs;

        const iobNowWithoutSuspend = iob(iobInputs)[0];

        inputs = {
                clock: timestamp,
                history: [{
                    _type: 'TempBasalDuration',
                    'duration (min)': 45,
                    date: timestamp60mAgo,
                    timestamp: timestamp60mAgo
                }, {
                    _type: 'TempBasal',
                    rate: 2,
                    date: timestamp60mAgo,
                    timestamp: timestamp60mAgo
                }, {
                    _type: 'PumpSuspend',
                    date: timestamp45mAgo,
                    timestamp: timestamp45mAgo
                }, {
                    _type: 'PumpResume',
                    date: timestamp30mAgo,
                    timestamp: timestamp30mAgo
                }],
                profile: {
                    dia: 5,
                    current_basal: 1,
                    suspend_zeros_iob: true,
                    max_daily_basal: 1,
                    //bolussnooze_dia_divisor: 2,
                    'basalprofile': basalprofile
                }
            };

        iobInputs = inputs;

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should calculate IOB without counting time pump suspended surrounding a basal', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();
        const timestamp90mAgo = new Date(now - (90 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 45,
                date: timestamp75mAgo,
                timestamp: timestamp75mAgo
            }, {
                _type: 'TempBasal',
                rate: 0,
                date: timestamp75mAgo,
                timestamp: timestamp75mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp90mAgo,
                timestamp: timestamp90mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp90mAgo,
                timestamp: timestamp90mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs = inputs;

        const iobNowWithoutSuspend = iob(iobInputs)[0];

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'PumpResume',
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'PumpSuspend',
                date: timestamp75mAgo,
                timestamp: timestamp75mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp90mAgo,
                timestamp: timestamp90mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp90mAgo,
                timestamp: timestamp90mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        iobInputs = inputs;

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should calculate IOB without counting time pump suspended at beginning of basal', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 0,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs: any = inputs;

        const iobNowWithoutSuspend = iob(iobInputs)[0];

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'PumpSuspend',
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'PumpResume',
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                'basalprofile': basalprofile
            }
        };

        iobInputs = inputs;

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should calculate IOB without counting time pump suspended when pump suspend prior to history start', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();
        const timestamp480mAgo = new Date(now - (480 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 435,
                date: timestamp480mAgo,
                timestamp: timestamp480mAgo
            }, {
                _type: 'TempBasal',
                rate: 0,
                date: timestamp480mAgo,
                timestamp: timestamp480mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs = inputs;

        const iobNowWithoutSuspend = iob(iobInputs)[0];

        inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp60mAgo,
                timestamp: timestamp60mAgo
            }, {
                _type: 'PumpResume',
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        iobInputs = inputs;

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should calculate IOB without counting time pump suspended when pump is currently suspended', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestamp15mAgo = new Date(now - (15 * 60 * 1000)).toISOString();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp45mAgo = new Date(now - (45 * 60 * 1000)).toISOString();
        const timestamp60mAgo = new Date(now - (60 * 60 * 1000)).toISOString();
        const timestamp75mAgo = new Date(now - (75 * 60 * 1000)).toISOString();

        let inputs: any = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 15,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp45mAgo,
                timestamp: timestamp45mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                suspend_zeros_iob: true,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        let iobInputs = inputs;

        const iobNowWithoutSuspend = iob(iobInputs)[0];

            inputs = {
                clock: timestamp,
                history: [{
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: timestamp45mAgo,
                    timestamp: timestamp45mAgo
                }, {
                    _type: 'TempBasal',
                    rate: 2,
                    date: timestamp45mAgo,
                    timestamp: timestamp45mAgo
                }, {
                    _type: 'PumpSuspend',
                    date: timestamp30mAgo,
                    timestamp: timestamp30mAgo
                }],
                profile: {
                    dia: 3,
                    current_basal: 1,
                    suspend_zeros_iob: true,
                    max_daily_basal: 1,
                    //bolussnooze_dia_divisor: 2,
                    'basalprofile': basalprofile
                }
            };

        const iobNowWithSuspend = iob(iobInputs)[0];

        expect(iobNowWithSuspend.iob).toBe(iobNowWithoutSuspend.iob);
    });

    it('should not report negative IOB with Temp Basals and a basal profile with drastic changes', () => {

        const basalprofile = [{
                'i': 0,
                'start': '00:00:00',
                'rate': 0.1,
                'minutes': 0
            },
            {
                'i': 1,
                'start': '00:30:00',
                'rate': 2,
                'minutes': 30
            }
        ];

        const startingPoint = new Date('2016-06-13 00:00:00.000');
        const startingPoint2 = new Date('2016-06-13 00:30:00.000');
        const endPoint = new Date('2016-06-13 01:00:00.000');

        const inputs = {
            clock: endPoint,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: startingPoint,
                timestamp: startingPoint
            }, {
                _type: 'TempBasal',
                rate: 0.1,
                date: startingPoint,
                timestamp: startingPoint
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: startingPoint2,
                timestamp: startingPoint2
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: startingPoint2,
                timestamp: startingPoint2
            }],
            profile: {
                dia: 3,
                current_basal: 2,
                max_daily_basal: 2,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        const hourLaterInputs = inputs;
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBe(0);
    });

    it('should calculate IOB with Temp Basal events that overlap', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp30mAgo = new Date(now - (30 * 60 * 1000)).toISOString();
        const timestamp31mAgo = new Date(now - (31 * 60 * 1000)).toISOString();
        const inputs = {
            clock: timestamp30mAgo,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp31mAgo,
                timestamp: timestamp31mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp31mAgo,
                timestamp: timestamp31mAgo
            }, {
                _type: 'TempBasal',
                rate: 2,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp30mAgo,
                timestamp: timestamp30mAgo
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                max_daily_basal: 1,
                'basalprofile': basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBeLessThan(1);
        expect(hourLater.iob).toBeGreaterThan(0);
    });

    it('should calculate IOB with Temp Basals that are lower than base rate', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 2,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestampEarly = new Date(now - (30 * 60 * 1000)).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestampEarly,
                timestamp: timestampEarly
            }, {
                _type: 'TempBasal',
                rate: 1,
                date: timestampEarly,
                timestamp: timestampEarly
            }, {
                _type: 'TempBasal',
                rate: 1,
                date: timestamp,
                timestamp: timestamp
            }, {
                _type: 'TempBasalDuration',
                'duration (min)': 30,
                date: timestamp,
                timestamp: timestamp
            }],
            profile: {
                dia: 3,
                current_basal: 2,
                max_daily_basal: 2,
                //bolussnooze_dia_divisor: 2,
                'basalprofile': basalprofile
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBeLessThan(0);
        expect(hourLater.iob).toBeGreaterThan(-1);
    });

    it('should show 0 IOB with Temp Basals if duration is not found', () => {

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestampEarly = new Date(now - (60 * 60 * 1000)).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                debug: "should show 0 IOB with Temp Basals if duration is not found",
                _type: 'TempBasal',
                rate: 2,
                date: timestamp,
                timestamp: timestamp
            }],
            profile: {
                dia: 3,
                current_basal: 1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2
            }
        };

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBe(0);
    });

    it('should show 0 IOB with Temp Basals if basal is percentage based', () => {

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const timestampEarly = new Date(now - (60 * 60 * 1000)).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                    _type: 'TempBasal',
                    temp: 'percent',
                    rate: 2,
                    date: timestamp,
                    timestamp: timestamp
                },
                {
                    _type: 'TempBasalDuration',
                    'duration (min)': 30,
                    date: timestamp,
                    timestamp: timestamp
                }
            ],
            profile: {
                dia: 3,
                current_basal: 1,
                max_daily_basal: 1,
                //bolussnooze_dia_divisor: 2
            }
        };


        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];

        expect(hourLater.iob).toBe(0);
    });

    it('should calculate IOB using a 4 hour duration', () => {

        const basalprofile = [{
            'i': 0,
            'start': '00:00:00',
            'rate': 1,
            'minutes': 0
        }];

        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const inputs = {
            clock: timestamp,
            history: [{
                _type: 'Bolus',
                amount: 1,
                timestamp: timestamp
            }],
            profile: {
                dia: 4,
                //bolussnooze_dia_divisor: 2,
                basalprofile: basalprofile,
                current_basal: 1,
                max_daily_basal: 1
            }

        };

        const rightAfterBolus = iob(inputs)[0];
        expect(rightAfterBolus.iob).toBe(1);
        //rightAfterBolus.bolussnooze.should.equal(1);

        const hourLaterInputs = inputs;
        hourLaterInputs.clock = new Date(now + (60 * 60 * 1000)).toISOString();
        const hourLater = iob(hourLaterInputs)[0];
        expect(hourLater.iob).toBeLessThan(1);
        //hourLater.bolussnooze.should.be.lessThan(.5);
        expect(hourLater.iob).toBeGreaterThan(0);

        const after3hInputs = inputs;
        after3hInputs.clock = new Date(now + (3 * 60 * 60 * 1000)).toISOString();
        const after3h = iob(after3hInputs)[0];
        expect(after3h.iob).toBeGreaterThan(0);

        const after4hInputs = inputs;
        after4hInputs.clock = new Date(now + (4 * 60 * 60 * 1000)).toISOString();
        const after4h = iob(after4hInputs)[0];
        expect(after4h.iob).toBe(0);
    });

});
