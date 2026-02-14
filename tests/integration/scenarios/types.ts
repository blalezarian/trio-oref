/**
 * Shared types for integration test scenarios.
 */

import type { RawPipelineInputs } from '../helpers/rawInputs';
import type { PipelineResult } from '../pipeline';

/** A single clinical assertion on the pipeline result */
export type ClinicalAssertion = (result: PipelineResult) => void;

/** A named integration test scenario */
export interface IntegrationScenario {
    /** Human-readable name describing the clinical situation */
    name: string;
    /** Category for grouped test output */
    category: string;
    /** Raw inputs as Trio would provide them */
    inputs: RawPipelineInputs;
    /** Explicit clinical assertions on the dosing decision */
    assertions: ClinicalAssertion[];
}
