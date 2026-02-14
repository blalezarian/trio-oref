/**
 * Aggregate all integration scenarios for the test runner.
 */

import { steadyStateScenarios } from './steadyState';
import { postMealScenarios } from './postMeal';
import { highBgScenarios } from './highBg';
import { lowBgScenarios } from './lowBg';
import { smbEnabledScenarios } from './smbEnabled';
import { uamScenarios } from './uam';
import { cgmGapScenarios } from './cgmGaps';
import { exerciseModeScenarios } from './exerciseMode';
import { edgeCaseScenarios } from './edgeCases';
import type { IntegrationScenario } from './types';

export const allScenarios: IntegrationScenario[] = [
    ...steadyStateScenarios,
    ...postMealScenarios,
    ...highBgScenarios,
    ...lowBgScenarios,
    ...smbEnabledScenarios,
    ...uamScenarios,
    ...cgmGapScenarios,
    ...exerciseModeScenarios,
    ...edgeCaseScenarios,
];

export type { IntegrationScenario } from './types';
