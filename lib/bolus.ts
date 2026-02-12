
import type { PumpHistoryEvent } from './types/index';
import { MS_PER_MINUTE } from './constants';

/** Minutes window for grouping related bolus events */
const BOLUS_GROUPING_MINUTES = 2;
/** Percentage multiplier */
const PERCENT = 100;

interface BolusTreatment {
  _type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface BolusResult {
  eventType?: string;
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

interface BolusAccumulator {
  carbs?: string;
  ratio?: string;
  bg?: string;
  glucose?: string;
  glucoseType?: string;
  wizard?: PumpHistoryEvent;
  created_at?: string;
  timestamp?: string;
  duration?: string;
  square?: PumpHistoryEvent;
  bolus?: PumpHistoryEvent;
  eventType?: string;
  insulin?: number | string;
  notes?: string[] | string;
  [key: string]: unknown;
}

function reduce (treatments: BolusTreatment[]): BolusResult[] {

  const results: BolusResult[] = [ ];

  let state: BolusAccumulator = { };
  const previous: BolusTreatment[] = [ ];

  function in_previous (ev: BolusTreatment): boolean {
    let found = false;
    previous.forEach((elem: BolusTreatment) => {
      if (elem.timestamp === ev.timestamp && ev._type === elem._type) {
        found = true;
      }
    });

    return found;
  }

  function within_minutes_from (origin: BolusTreatment, tail: BolusTreatment[], minutes: number): BolusTreatment[] {
    const ms = minutes * MS_PER_MINUTE;
    const ts = Date.parse(origin.timestamp);
    return /* candidates */ tail.slice( ).filter((elem: BolusTreatment) => {
      const dt = Date.parse(elem.timestamp);
      return ts - dt <= ms;
    });
  }

  function bolus (ev: PumpHistoryEvent, remaining: PumpHistoryEvent[]): void {
    if (!ev) { console.error('XXX', ev, remaining); return; }
    if (ev._type === 'BolusWizard') {
      state.carbs = ev.carb_input!.toString( );
      state.ratio = ev.carb_ratio!.toString( );
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
      state.duration = ev.duration!.toString( );
      // if (state.square || state.bolus) { }
      // state.insulin = (state.insulin ? state.insulin : 0) + ev.amount;
      if (ev.duration && ev.duration > 0) {
        state.square = ev;
      } else {
        if (state.bolus) {
          state.bolus.amount = state.bolus.amount! + ev.amount!;
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

      state.insulin = ((state.insulin ? state.insulin : 0) as number) + (state.square ? state.square.amount! : 0) +
            (state.bolus ? state.bolus.amount! : 0);
      const has_insulin = state.insulin && (state.insulin as number) > 0;
      const has_carbs = state.carbs && Number(state.carbs) > 0;
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
        const iobFile = "./monitor/iob.json";
        const fs = require('fs');
        if (fs.existsSync(iobFile)) {
            const iob = JSON.parse(fs.readFileSync(iobFile));
            if (iob && Array.isArray(iob) && iob.length) {
                annotate("Calculated IOB:", iob[0].iob);
            }
        }
      }

      if (state.bolus) {
        annotate("Programmed bolus", state.bolus.programmed);
        annotate("Delivered bolus", state.bolus.amount);
        annotate("Percent delivered: ", (state.bolus.amount!/state.bolus.programmed! * PERCENT).toString( ) + '%');
      }
      if (state.square) {
        annotate("Programmed square", state.square.programmed);
        annotate("Delivered square", state.square.amount);
        annotate("Success: ", (state.square.amount!/state.square.programmed! * PERCENT).toString( ) + '%');
      }
      if (state.wizard) {
        state.created_at = state.wizard.timestamp;
        annotate("Food estimate", state.wizard.food_estimate);
        annotate("Correction estimate", state.wizard.correction_estimate);
        annotate("Bolus estimate", state.wizard.bolus_estimate);
        annotate("Target low", state.wizard.bg_target_low);
        annotate("Target high", state.wizard.bg_target_high);
        const delta = state.wizard.sensitivity! * (state.insulin as number) * -1;
        annotate("Hypothetical glucose delta", delta);
        if (state.bg && Number(state.bg) > 0) {
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
      if (state.notes && (state.notes as string[]).length > 0) {
        state.notes = (state.notes as string[]).join("\n");
      }
      if (state.insulin) {
        state.insulin = (state.insulin as number).toString( );
      }

      results.push(state as BolusResult);
      state = { };
    }
  }

  function annotate (...args: unknown[]): void {
    const msg = args.join(' ');
    if (!state.notes) {
      state.notes = [ ];
    }
    (state.notes as string[]).push(msg);
  }

  function step (current: BolusTreatment, index: number): void {
    if (in_previous(current)) {
      return;
    }
    switch (current._type) {
      case 'Bolus':
      case 'BolusWizard': {
        const tail = within_minutes_from(current, treatments.slice(index+1), BOLUS_GROUPING_MINUTES);
        bolus(current, tail);
        break;
      }
      case 'JournalEntryMealMarker':
        (current as BolusResult).carbs = current.carb_input as string;
        (current as BolusResult).eventType = 'Carb Correction';
        results.push(current as BolusResult);
        break;
      default:
        results.push(current as BolusResult);
        break;
    }
  }
  treatments.forEach(step);
  return results;
}

export default reduce;
