
import tz from 'moment-timezone';
import find_meals from './history';
import sum from './total';

interface MealGenerateInputs {
  history: any[];
  carbs: any[];
  profile: Record<string, unknown>;
  clock: string;
  glucose?: any[];
  basalprofile: any[];
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

  var clock = new Date(tz(inputs.clock) as any);

  return /* meal_data */ sum(opts, clock);
}

export default generate;
