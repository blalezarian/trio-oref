/** @deprecated Not used by the Trio algorithm pipeline. Candidate for removal. */

import type { PumpHistoryEvent } from './types/index';

interface TempBasalState {
  duration?: string;
  raw_duration?: PumpHistoryEvent;
  percent?: string;
  absolute?: string;
  rate?: number;
  raw_rate?: PumpHistoryEvent;
  timestamp?: string;
  invalid?: boolean;
  eventType?: string;
  [key: string]: unknown;
}

function filter (treatments: PumpHistoryEvent[]) {

  const results: Array<PumpHistoryEvent | TempBasalState> = [ ];

  let state: TempBasalState = { };

  function temp (ev: PumpHistoryEvent) {
    if ('duration (min)' in ev) {
      state.duration = ev['duration (min)']!.toString( );
      state.raw_duration = ev;
    }

    if ('rate' in ev) {
      state[ev.temp as string] = ev.rate!.toString( );
      state.rate = ev['rate'];
      state.raw_rate = ev;
    }

    if ('timestamp' in state && ev.timestamp !== state.timestamp) {
      state.invalid = true;
    } else {
      state.timestamp = ev.timestamp;
    }

    if ('duration' in state && ('percent' in state || 'absolute' in state)) {
      state.eventType = 'Temp Basal';
      results.push(state);
      state = { };
    }
  }

  function step (current: PumpHistoryEvent) {
    switch (current._type) {
      case 'TempBasalDuration':
      case 'TempBasal':
        temp(current);
        break;
      default:
        results.push(current);
        break;
    }
  }
  treatments.forEach(step);
  return results;
}

export default filter;
