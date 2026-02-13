import { MS_PER_MINUTE } from '../shared/constants';

/** Convert a schedule offset (minutes since midnight) to an epoch timestamp for today */
export function getTime(minutes: number): number {
    const baseTime = new Date();
    baseTime.setHours(0);
    baseTime.setMinutes(0);
    baseTime.setSeconds(0);

    return baseTime.getTime() + minutes * MS_PER_MINUTE;
}

