
import tz from 'moment-timezone';
import find_meals from './history';
import sum from './total';
import type { PumpHistoryEvent, GlucoseEntry } from '../types/index';

interface MealGenerateInputs {
  history: PumpHistoryEvent[];
  carbs: PumpHistoryEvent[];
  profile: Record<string, unknown>;
  clock: string;
  glucose?: GlucoseEntry[];
  basalprofile: Array<Record<string, unknown>>;
}

function generate (inputs: MealGenerateInputs): ReturnType<typeof sum> {

  var treatments = find_meals(inputs);

  var opts = {
    treatments: treatments
  , profile: inputs.profile
  , pumphistory: inputs.history
  , glucose: inputs.glucose
  , basalprofile: inputs.basalprofile
  };

  var clock = new Date(tz(inputs.clock).toDate());

  return /* meal_data */ sum(opts, clock);
}

export default generate;
