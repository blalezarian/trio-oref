import { describe, it, expect } from 'vitest';
import generate from '../../src/profile';

describe('Profile', () => {

    const baseInputs = {
        settings: {
            insulin_action_curve: 3
        },
        basals: [
            { minutes: 0, rate: 1 }
        ],
        targets: {
            targets: [
                { offset: 0, high: 120, low: 100 }
            ]
        },
        temptargets: [],
        isf: {
            sensitivities: [
                { offset: 0, sensitivity: 100 }
            ]
        },
        carbratio: {
            units: 'grams',
            schedule: [
                { offset: 0, ratio: 20 }
            ]
        }
    };

    it('should should create a profile from inputs', () => {
        const profile = generate(baseInputs);
        expect(profile.max_iob).toBe(0);
        expect(profile.dia).toBe(3);
        expect(profile.sens).toBe(100);
        expect(profile.current_basal).toBe(1);
        expect(profile.max_bg).toBe(100);
        expect(profile.min_bg).toBe(100);
        expect(profile.carb_ratio).toBe(20);
    });


    const currentTime = new Date();
    const creationDate = new Date(currentTime.getTime() - (5 * 60 * 1000));

    it('should create a profile with temptarget set', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { temptargets: [{ 'eventType': 'Temporary Target', 'reason': 'Eating Soon', 'targetTop': 80, 'targetBottom': 80, 'duration': 20, 'created_at': creationDate }] }));
        expect(profile.max_iob).toBe(0);
        expect(profile.dia).toBe(3);
        expect(profile.sens).toBe(100);
        expect(profile.current_basal).toBe(1);
        expect(profile.max_bg).toBe(80);
        expect(profile.min_bg).toBe(80);
        expect(profile.carb_ratio).toBe(20);
        expect(profile.temptargetSet).toBe(true);
    });


    const pastDate = new Date(currentTime.getTime() - 90 * 60 * 1000);
    it('should create a profile ignoring an out of date temptarget', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { temptargets: [{ 'eventType': 'Temporary Target', 'reason': 'Eating Soon', 'targetTop': 80, 'targetBottom': 80, 'duration': 20, 'created_at': pastDate }] }));
        expect(profile.max_iob).toBe(0);
        expect(profile.dia).toBe(3);
        expect(profile.sens).toBe(100);
        expect(profile.current_basal).toBe(1);
        expect(profile.max_bg).toBe(100);
        expect(profile.min_bg).toBe(100);
        expect(profile.carb_ratio).toBe(20);
    });

    it('should create a profile ignoring a temptarget with 0 duration', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { temptargets: [{ 'eventType': 'Temporary Target', 'reason': 'Eating Soon', 'targetTop': 80, 'targetBottom': 80, 'duration': 0, 'created_at': creationDate }] }));
        expect(profile.max_iob).toBe(0);
        expect(profile.dia).toBe(3);
        expect(profile.sens).toBe(100);
        expect(profile.current_basal).toBe(1);
        expect(profile.max_bg).toBe(100);
        expect(profile.min_bg).toBe(100);
        expect(profile.carb_ratio).toBe(20);
    });


    it('should error with invalid DIA', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { settings: { insulin_action_curve: 1 } }));
        expect(profile).toBe(-1);
    });

    it('should error with a current basal of 0', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { basals: [{ minutes: 0, rate: 0 }] }));
        expect(profile).toBe(-1);
    });


    it('should set the profile model from input', () => {
        const profile = generate(Object.assign(JSON.parse(JSON.stringify(baseInputs)), { model: 554 }));
        expect(profile.model).toBe(554);
    });


});
