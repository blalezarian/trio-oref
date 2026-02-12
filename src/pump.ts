/** @deprecated Not used by the Trio algorithm pipeline. Candidate for removal. */

import type { PumpHistoryEvent } from './types/index';

function translate (treatments: PumpHistoryEvent[]) {

  const results: PumpHistoryEvent[] = [ ];

  function step (current: PumpHistoryEvent) {
    let invalid = false;
    switch (current._type) {
      case 'CalBGForPH':
        current.eventType = 'BG Check';
        current.glucose = current.amount;
        current.glucoseType = 'Finger';
        break;
      case 'BasalProfileStart':
      case 'ResultDailyTotal':
      case 'BGReceived':
      case 'Sara6E':
      case 'Model522ResultTotals':
      case 'Model722ResultTotals':
        invalid = true;
        break;
      default:
        break;
    }

    if (!invalid) {
      results.push(current);
    }

  }
  treatments.forEach(step);
  return results;
}

export default translate;
