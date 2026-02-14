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
import { autosensScenarios } from './autosens';
import { tempTargetScenarios } from './tempTargets';
import { trioOverrideScenarios } from './trioOverrides';
import { dynamicIsfScenarios } from './dynamicIsf';
import { maxIobScenarios } from './maxIob';
import { bgTransitionScenarios } from './bgTransitions';
import { stackedMealScenarios } from './stackedMeals';
import { sensitiveProfileScenarios } from './sensitiveProfile';
import { profileSettingsScenarios } from './profileSettings';
import { insulinCurveScenarios } from './insulinCurves';
import { multiScheduleScenarios } from './multiSchedule';
import { pumpSuspendScenarios } from './pumpSuspend';
import { nightscoutEventScenarios } from './nightscoutEvents';
import { mmolUnitScenarios } from './mmolUnits';
import { middlewareScenarios } from './middleware';
import { safetyBoundsScenarios } from './safetyBounds';
import { dangerousInputScenarios } from './dangerousInputs';
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
    ...autosensScenarios,
    ...tempTargetScenarios,
    ...trioOverrideScenarios,
    ...dynamicIsfScenarios,
    ...maxIobScenarios,
    ...bgTransitionScenarios,
    ...stackedMealScenarios,
    ...sensitiveProfileScenarios,
    ...profileSettingsScenarios,
    ...insulinCurveScenarios,
    ...multiScheduleScenarios,
    ...pumpSuspendScenarios,
    ...nightscoutEventScenarios,
    ...mmolUnitScenarios,
    ...middlewareScenarios,
    ...safetyBoundsScenarios,
    ...dangerousInputScenarios,
];

export type { IntegrationScenario } from './types';
