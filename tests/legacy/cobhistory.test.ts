import { describe, it, expect } from 'vitest';
import { findMealInputs } from '../../src/meal/history';
import type { PumpHistoryEvent } from '../../src/types/index';

describe('cobhistory', () => {

    const pumpHistory: PumpHistoryEvent[] = [
        {"_type": "BolusWizard","timestamp": "2016-06-19T12:51:36-04:00","carb_input": 40},
        {"_type": "Bolus","timestamp": "2016-06-19T12:52:36-04:00","amount": 4.4},
        {"_type": "BolusWizard","timestamp": "2016-06-19T12:57:36-04:00","carb_input": 40},
        {"_type": "Bolus","timestamp": "2016-06-19T12:57:36-04:00","amount": 4.4},
        {"_type": "Bolus","timestamp": "2016-06-19T15:33:42-04:00","amount": 1.5},

        {"_type": "BolusWizard","timestamp": "2016-06-19T12:59:36-04:00","carb_input": 40},
        {"_type": "Bolus","timestamp": "2016-06-19T12:59:36-04:00","amount": 4.4},
        {"_type": "BolusWizard","timestamp": "2016-06-19T12:59:36-04:00","carb_input": 40},
        {"_type": "Bolus","timestamp": "2016-06-19T12:59:36-04:00","amount": 4.4}
    ];

    const carbHistory: PumpHistoryEvent[] = [
        {"_type": "BolusWizard","created_at": "2016-06-19T12:59:36-04:00","carbs": 40},
        {"_type": "Bolus","created_at": "2016-06-19T12:59:36-04:00","amount": 4.4},
        {"_type": "BolusWizard","created_at": "2016-06-19T12:59:36-04:00","carbs": 40},
        {"_type": "Bolus","created_at": "2016-06-19T12:59:36-04:00","amount": 4.4}
    ];

   //function determine_basal(glucose_status, currenttemp, iob_data, profile)

    it('should dedupe entries', () => {
        const inputs = {
            history: pumpHistory,
            carbs: carbHistory,
            profile: {},
        } as any;

        const output = findMealInputs(inputs);

        console.log(output);

        // BolusWizard carb_input without a timestamp-matched Bolus will be ignored
        expect(output.length).toBe(6);
    });

});
