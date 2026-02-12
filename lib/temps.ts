/** @deprecated Not used by the Trio algorithm pipeline. Candidate for removal. */

function filter (treatments: any[]) {

  var results: any[] = [ ];

  var state: any = { };

  function temp (ev: any) {
    if ('duration (min)' in ev) {
      state.duration = ev['duration (min)'].toString( );
      state.raw_duration = ev;
    }

    if ('rate' in ev) {
      state[ev.temp] = ev.rate.toString( );
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

  function step (current: any) {
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
