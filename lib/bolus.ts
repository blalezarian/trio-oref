
interface BolusTreatment {
  _type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface BolusResult {
  eventType: string;
  insulin?: string;
  carbs?: string;
  ratio?: string;
  bg?: string;
  glucose?: string;
  glucoseType?: string;
  duration?: string;
  notes?: string;
  created_at?: string;
  timestamp?: string;
  [key: string]: unknown;
}

function reduce (treatments: BolusTreatment[]): BolusResult[] {

  var results: BolusResult[] = [ ];

  var state: Record<string, any> = { };
  var previous: BolusTreatment[] = [ ];

  function in_previous (ev: BolusTreatment): boolean {
    var found = false;
    previous.forEach(function (elem: BolusTreatment) {
      if (elem.timestamp === ev.timestamp && ev._type === elem._type) {
        found = true;
      }
    });

    return found;
  }

  function within_minutes_from (origin: BolusTreatment, tail: BolusTreatment[], minutes: number): BolusTreatment[] {
    var ms = minutes * 1000 * 60;
    var ts = Date.parse(origin.timestamp);
    return /* candidates */ tail.slice( ).filter(function (elem: BolusTreatment) {
      var dt = Date.parse(elem.timestamp);
      return ts - dt <= ms;
    });
  }

  function bolus (ev: Record<string, any>, remaining: Record<string, any>[]): void {
    if (!ev) { console.error('XXX', ev, remaining); return; }
    if (ev._type === 'BolusWizard') {
      state.carbs = ev.carb_input.toString( );
      state.ratio = ev.carb_ratio.toString( );
      if (ev.bg) {
        state.bg = ev.bg.toString( );
        state.glucose = ev.bg.toString( );
        state.glucoseType = ev._type;
      }
      state.wizard = ev;
      state.created_at = state.timestamp = ev.timestamp;
      previous.push(ev as BolusTreatment);
    }

    if (ev._type === 'Bolus') {
      state.duration = ev.duration.toString( );
      // if (state.square || state.bolus) { }
      // state.insulin = (state.insulin ? state.insulin : 0) + ev.amount;
      if (ev.duration && ev.duration > 0) {
        state.square = ev;
      } else {
        if (state.bolus) {
          state.bolus.amount = state.bolus.amount + ev.amount;
        } else
          state.bolus = ev;
      }
      state.created_at = state.timestamp = ev.timestamp;
      previous.push(ev as BolusTreatment);
    }

    if (remaining && remaining.length > 0) {
      if (state.bolus && state.wizard) {
        // skip to end
        return bolus({}, []);
      }
      // keep recursing
      return bolus(remaining[0], remaining.slice(1));
    } else {
      // console.error("state", state);
      // console.error("remaining", remaining);
      state.eventType = '<none>';

      state.insulin = (state.insulin ? state.insulin : 0) + (state.square ? state.square.amount : 0) +
            (state.bolus ? state.bolus.amount : 0);
      var has_insulin = state.insulin && state.insulin > 0;
      var has_carbs = state.carbs && state.carbs > 0;
      if (state.square && state.bolus) {
        annotate("DualWave bolus for", state.square.duration, "minutes");
      } else if (state.square && state.wizard) {
        annotate("Square wave bolus for", state.square.duration, "minutes");
      } else if (state.square) {
        annotate("Solo Square wave bolus for", state.square.duration, "minutes");
        annotate("No bolus wizard used.");
      } else if (state.bolus && state.wizard) {
        annotate("Normal bolus with wizard.");
      } else if (state.bolus) {
        annotate("Normal bolus (solo, no bolus wizard).");
      }

      if (has_insulin) {
        var iobFile = "./monitor/iob.json";
        var fs = require('fs');
        if (fs.existsSync(iobFile)) {
            var iob = JSON.parse(fs.readFileSync(iobFile));
            if (iob && Array.isArray(iob) && iob.length) {
                annotate("Calculated IOB:", iob[0].iob);
            }
        }
      }

      if (state.bolus) {
        annotate("Programmed bolus", state.bolus.programmed);
        annotate("Delivered bolus", state.bolus.amount);
        annotate("Percent delivered: ", (state.bolus.amount/state.bolus.programmed * 100).toString( ) + '%');
      }
      if (state.square) {
        annotate("Programmed square", state.square.programmed);
        annotate("Delivered square", state.square.amount);
        annotate("Success: ", (state.square.amount/state.square.programmed * 100).toString( ) + '%');
      }
      if (state.wizard) {
        state.created_at = state.wizard.timestamp;
        annotate("Food estimate", state.wizard.food_estimate);
        annotate("Correction estimate", state.wizard.correction_estimate);
        annotate("Bolus estimate", state.wizard.bolus_estimate);
        annotate("Target low", state.wizard.bg_target_low);
        annotate("Target high", state.wizard.bg_target_high);
        var delta = state.wizard.sensitivity * state.insulin * -1;
        annotate("Hypothetical glucose delta", delta);
        if (state.bg && state.bg > 0) {
          annotate('Glucose was:', state.bg);
          // state.glucose = state.bg;
          // TODO: annotate prediction
        }
      }
      if (has_carbs && has_insulin) {
        state.eventType = 'Meal Bolus';
      } else {
        if (has_carbs && !has_insulin) {
          state.eventType = 'Carb Correction';
        }
        if (!has_carbs && has_insulin) {
          state.eventType = 'Correction Bolus';
        }
      }
      if (state.notes && state.notes.length > 0) {
        state.notes = state.notes.join("\n");
      }
      if (state.insulin) {
        state.insulin = state.insulin.toString( );
      }

      results.push(state as BolusResult);
      state = { };
    }
  }

  function annotate (...args: any[]): void {
    var msg = args.join(' ');
    if (!state.notes) {
      state.notes = [ ];
    }
    state.notes.push(msg);
  }

  function step (current: BolusTreatment, index: number): void {
    if (in_previous(current)) {
      return;
    }
    switch (current._type) {
      case 'Bolus':
      case 'BolusWizard':
        var tail = within_minutes_from(current, treatments.slice(index+1), 2);
        bolus(current, tail);
        break;
      case 'JournalEntryMealMarker':
        (current as any).carbs = (current as any).carb_input;
        (current as any).eventType = 'Carb Correction';
        results.push(current as any);
        break;
      default:
        results.push(current as any);
        break;
    }
  }
  treatments.forEach(step);
  return results;
}

export default reduce;
