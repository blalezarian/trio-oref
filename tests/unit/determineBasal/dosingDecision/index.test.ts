import { describe, it, expect, vi, beforeEach } from 'vitest';

import { calculateDosingDecision } from '../../../../src/determineBasal/dosingDecision/index';
import { makeDosingInputs } from '../../helpers';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// calculateDosingDecision
// ---------------------------------------------------------------------------

describe('calculateDosingDecision', () => {
    it('returns a DetermineBasalResult from the pipeline', () => {
        // With eventualBG=150 > max_bg=120 and non-SMB mode, the pipeline should
        // proceed through phases and return from applyFinalHighTemp.
        const inputs = makeDosingInputs();
        const result = calculateDosingDecision(inputs);

        // The pipeline always terminates before the unreachable line 57 fallthrough
        expect(result).toBeDefined();
        expect(typeof result.reason).toBe('string');
    });

    it('returns early from handleLowBG when eventualBG < min_bg', () => {
        // eventualBG=60 < min_bg=80 triggers handleLowBG early return
        const inputs = makeDosingInputs({
            eventualBG: 60,
            naiveEventualBG: 60,
            minDelta: -1,
            expectedDelta: 0,
        });
        const result = calculateDosingDecision(inputs);

        expect(result).toBeDefined();
        expect(result.reason).toContain('Eventual BG');
    });
});
