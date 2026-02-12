interface BasalScheduleEntry {
  i?: number;
  minutes?: number;
  rate: number;
}

interface BasalInputs {
  basals: BasalScheduleEntry[];
  settings: { maxBasal: number };
}

declare function basalLookup(schedules: BasalScheduleEntry[], now?: Date): number | undefined;
declare function maxDailyBasal(inputs: BasalInputs): number;
declare function maxBasalLookup(inputs: BasalInputs): number;

export { basalLookup, maxDailyBasal, maxBasalLookup };
